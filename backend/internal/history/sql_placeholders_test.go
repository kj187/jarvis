package history

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// Critical Invariant #10: SQL in these packages (history, users, settings,
// globalsettings) uses ? placeholders only;
// rebind() turns them into $N for PostgreSQL. A $1 literal would work on
// PostgreSQL and silently break SQLite. The check looks at string literals
// (not comments) so documentation may still mention $N.
var dollarPlaceholder = regexp.MustCompile(`\$[0-9]`)

func placeholderViolations(t *testing.T, filename, src string) []string {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, filename, src, 0)
	if err != nil {
		t.Fatalf("parse %s: %v", filename, err)
	}
	var out []string
	ast.Inspect(file, func(n ast.Node) bool {
		lit, ok := n.(*ast.BasicLit)
		if !ok || lit.Kind != token.STRING {
			return true
		}
		val, err := strconv.Unquote(lit.Value)
		if err != nil {
			val = lit.Value
		}
		if dollarPlaceholder.MatchString(val) {
			out = append(out, fset.Position(lit.Pos()).String()+": "+strings.TrimSpace(val))
		}
		return true
	})
	return out
}

// Every package that builds SQL through rebind() is scanned, not only
// history. pgOnlyFiles lists files that are PostgreSQL-only by design and may
// use $N (paths as globbed from the history package directory, e.g. ../users/x.go); keep it empty unless a
// file really never runs on SQLite.
var (
	rebindPackages = []string{".", "../users", "../settings", "../globalsettings"}
	pgOnlyFiles    = map[string]bool{}
)

// The scanned list must not go stale: every package under internal/ with a
// non-test file that calls rebind( has to be in rebindPackages, and vice versa.
func TestRebindPackagesListIsComplete(t *testing.T) {
	want := map[string]bool{}
	for _, dir := range rebindPackages {
		if dir == "." {
			want["history"] = true
			continue
		}
		want[filepath.Base(dir)] = true
	}

	got := map[string]bool{}
	entries, err := os.ReadDir("..")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		files, _ := filepath.Glob(filepath.Join("..", e.Name(), "*.go"))
		for _, f := range files {
			if strings.HasSuffix(f, "_test.go") {
				continue
			}
			raw, err := os.ReadFile(f) // #nosec G304 -- paths come from Glob over the internal/ tree
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(raw), "rebind(") {
				got[e.Name()] = true
			}
		}
	}
	for pkg := range got {
		if !want[pkg] {
			t.Errorf("package %q calls rebind( but is not in rebindPackages — add it so invariant #10 covers it", pkg)
		}
	}
	for pkg := range want {
		if !got[pkg] {
			t.Errorf("rebindPackages lists %q, but it no longer calls rebind( — remove it", pkg)
		}
	}
}

func TestSQLUsesQuestionMarkPlaceholdersOnly(t *testing.T) {
	var files []string
	for _, dir := range rebindPackages {
		matches, err := filepath.Glob(filepath.Join(dir, "*.go"))
		if err != nil || len(matches) == 0 {
			t.Fatalf("no source files found in %s (err=%v)", dir, err)
		}
		files = append(files, matches...)
	}
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") || pgOnlyFiles[filepath.ToSlash(filepath.Clean(f))] {
			continue
		}
		raw, err := os.ReadFile(f) // #nosec G304 -- file names come from Glob("*.go") in the package directory
		if err != nil {
			t.Fatal(err)
		}
		src := string(raw)
		for _, v := range placeholderViolations(t, f, src) {
			t.Errorf("$N placeholder in SQL (use ? and rebind): %s", v)
		}
	}
}

func TestPlaceholderCheck_DetectsViolations(t *testing.T) {
	bad := []string{
		"package p\nconst q = `SELECT * FROM t WHERE id = $1`",
		"package p\nvar q = \"UPDATE t SET a = $2 WHERE b = ?\"",
		"package p\nfunc f() string { return \"INSERT INTO t VALUES ($1, $2)\" }",
	}
	for _, src := range bad {
		if len(placeholderViolations(t, "bad.go", src)) == 0 {
			t.Errorf("not detected: %s", src)
		}
	}
	good := []string{
		"package p\nconst q = `SELECT * FROM t WHERE id = ?`",
		"package p\n// Docs may say $1 in a comment.\nvar x = \"price in $\"",
		"package p\nfunc f(n int) string { return \"$\" + string(rune(n)) }",
	}
	for _, src := range good {
		if v := placeholderViolations(t, "good.go", src); len(v) != 0 {
			t.Errorf("false positive %v in: %s", v, src)
		}
	}
}
