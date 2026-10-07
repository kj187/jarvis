package db

import (
	"go/ast"
	"go/constant"
	"go/importer"
	"go/parser"
	"go/token"
	"go/types"
	"os"
	"strconv"
	"testing"
)

// Critical Invariant #8: SQLite is a single writer (SetMaxOpenConns(1)); the
// PostgreSQL pool is capped by configuration and never unbounded (0) and never
// a hard-coded 1, with MaxIdle equal to MaxOpen. The runtime assertions live
// in db_test.go; this file pins the source so a literal cannot slip back in
// unnoticed (the PostgreSQL runtime test is skipped without a database).

// poolInvariantViolations reports every way the Open functions in src break
// the invariant.
func poolInvariantViolations(t *testing.T, src string) []string {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "db.go", src, 0)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	// calls[func][method] = the argument expression of the Set* call.
	calls := map[string]map[string]ast.Expr{}
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Body == nil {
			continue
		}
		ast.Inspect(fn.Body, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok || len(call.Args) != 1 {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || (sel.Sel.Name != "SetMaxOpenConns" && sel.Sel.Name != "SetMaxIdleConns") {
				return true
			}
			if calls[fn.Name.Name] == nil {
				calls[fn.Name.Name] = map[string]ast.Expr{}
			}
			calls[fn.Name.Name][sel.Sel.Name] = call.Args[0]
			return true
		})
	}

	// Constant-fold the arguments (named constants, negative literals, 2-1, …);
	// unresolved imports are tolerated, only constant values matter here.
	info := &types.Info{Types: map[ast.Expr]types.TypeAndValue{}}
	tc := types.Config{Importer: importer.Default(), Error: func(error) {}}
	_, _ = tc.Check("db", fset, []*ast.File{file}, info)
	constInt := func(e ast.Expr) (int64, bool) {
		tv, ok := info.Types[e]
		if !ok || tv.Value == nil || tv.Value.Kind() != constant.Int {
			return 0, false
		}
		return constant.Int64Val(tv.Value)
	}

	exprString := func(e ast.Expr) string {
		if e == nil {
			return ""
		}
		return src[fset.Position(e.Pos()).Offset:fset.Position(e.End()).Offset]
	}

	var out []string

	sqlite := calls["openSQLite"]["SetMaxOpenConns"]
	if v, ok := constInt(sqlite); !ok || v != 1 {
		out = append(out, "openSQLite must call SetMaxOpenConns(1), got "+strconv.Quote(exprString(sqlite)))
	}

	open := calls["openPostgres"]["SetMaxOpenConns"]
	idle := calls["openPostgres"]["SetMaxIdleConns"]
	if open == nil {
		out = append(out, "openPostgres must cap the pool with SetMaxOpenConns (unbounded exhausts server connection slots)")
	} else {
		if _, constantCap := constInt(open); constantCap {
			out = append(out, "openPostgres must take the cap from configuration, not the constant "+strconv.Quote(exprString(open)))
		}
		if exprString(idle) != exprString(open) {
			out = append(out, "openPostgres must set SetMaxIdleConns to the same value as SetMaxOpenConns, got "+strconv.Quote(exprString(idle)))
		}
	}
	return out
}

func TestPoolInvariant_RealSource(t *testing.T) {
	src, err := os.ReadFile("db.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range poolInvariantViolations(t, string(src)) {
		t.Error(v)
	}
}

func TestPoolInvariant_RejectsViolatingSource(t *testing.T) {
	const head = "package db\ntype C struct{ n int }\ntype D struct{}\nfunc (D) SetMaxOpenConns(int) {}\nfunc (D) SetMaxIdleConns(int) {}\n"
	good := head + `
func openSQLite(d D)   { d.SetMaxOpenConns(1) }
func openPostgres(d D, cfg C) { d.SetMaxOpenConns(cfg.n); d.SetMaxIdleConns(cfg.n) }`

	cases := []struct {
		name, src string
	}{
		{"sqlite unbounded", head + "func openSQLite(d D) { d.SetMaxOpenConns(0) }\nfunc openPostgres(d D, cfg C) { d.SetMaxOpenConns(cfg.n); d.SetMaxIdleConns(cfg.n) }"},
		{"sqlite pool of several", head + "func openSQLite(d D) { d.SetMaxOpenConns(4) }\nfunc openPostgres(d D, cfg C) { d.SetMaxOpenConns(cfg.n); d.SetMaxIdleConns(cfg.n) }"},
		{"sqlite cap removed", head + "func openSQLite(d D) {}\nfunc openPostgres(d D, cfg C) { d.SetMaxOpenConns(cfg.n); d.SetMaxIdleConns(cfg.n) }"},
		{"postgres hard-coded 1", head + "func openSQLite(d D) { d.SetMaxOpenConns(1) }\nfunc openPostgres(d D, cfg C) { d.SetMaxOpenConns(1); d.SetMaxIdleConns(1) }"},
		{"postgres unbounded literal", head + "func openSQLite(d D) { d.SetMaxOpenConns(1) }\nfunc openPostgres(d D, cfg C) { d.SetMaxOpenConns(0); d.SetMaxIdleConns(0) }"},
		{"postgres named constant", head + "const one = 1\nfunc openSQLite(d D) { d.SetMaxOpenConns(1) }\nfunc openPostgres(d D, cfg C) { d.SetMaxOpenConns(one); d.SetMaxIdleConns(one) }"},
		{"postgres negative literal", head + "func openSQLite(d D) { d.SetMaxOpenConns(1) }\nfunc openPostgres(d D, cfg C) { d.SetMaxOpenConns(-1); d.SetMaxIdleConns(-1) }"},
		{"postgres constant expression", head + "func openSQLite(d D) { d.SetMaxOpenConns(1) }\nfunc openPostgres(d D, cfg C) { d.SetMaxOpenConns(2 - 1); d.SetMaxIdleConns(2 - 1) }"},
		{"sqlite named constant not 1", head + "const n = 3\nfunc openSQLite(d D) { d.SetMaxOpenConns(n) }\nfunc openPostgres(d D, cfg C) { d.SetMaxOpenConns(cfg.n); d.SetMaxIdleConns(cfg.n) }"},
		{"postgres cap removed", head + "func openSQLite(d D) { d.SetMaxOpenConns(1) }\nfunc openPostgres(d D, cfg C) { d.SetMaxIdleConns(cfg.n) }"},
		{"postgres idle differs", head + "func openSQLite(d D) { d.SetMaxOpenConns(1) }\nfunc openPostgres(d D, cfg C) { d.SetMaxOpenConns(cfg.n); d.SetMaxIdleConns(2) }"},
	}

	if v := poolInvariantViolations(t, good); len(v) != 0 {
		t.Fatalf("control source flagged: %v", v)
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if len(poolInvariantViolations(t, tc.src)) == 0 {
				t.Error("violation not detected")
			}
		})
	}
}

// A zero, negative or single-connection cap must not reach the PostgreSQL pool.
func TestPoolInvariant_NonPositiveCapKeepsDefault(t *testing.T) {
	if defaultMaxOpenConns < 2 {
		t.Fatalf("default PostgreSQL cap = %d, want a bounded pool larger than 1", defaultMaxOpenConns)
	}
	for _, n := range []int{1, 0, -1, -100} {
		cfg := defaultPoolConfig()
		WithMaxOpenConns(n)(&cfg)
		if cfg.maxOpenConns != defaultMaxOpenConns {
			t.Errorf("WithMaxOpenConns(%d) changed the cap to %d, want default %d", n, cfg.maxOpenConns, defaultMaxOpenConns)
		}
	}
}
