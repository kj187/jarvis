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

// Critical Invariant #10: SQL in this package uses ? placeholders only;
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

func TestSQLUsesQuestionMarkPlaceholdersOnly(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil || len(files) == 0 {
		t.Fatalf("no source files found (err=%v)", err)
	}
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
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
