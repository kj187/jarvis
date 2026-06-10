package db

import (
	"context"
	"testing"
)

func TestOpen_InMemory(t *testing.T) {
	database, dialect, err := Open(":memory:")
	if err != nil {
		t.Fatalf("Open() error: %v", err)
	}
	defer func() { _ = database.Close() }()

	if dialect != DialectSQLite {
		t.Errorf("dialect = %q, want sqlite", dialect)
	}
	if err := database.PingContext(context.Background()); err != nil {
		t.Fatalf("Ping() error: %v", err)
	}
}

func TestDetectDialect(t *testing.T) {
	cases := []struct {
		dsn  string
		want Dialect
	}{
		{"postgres://user:pass@host/db", DialectPostgres},
		{"postgresql://user:pass@host/db", DialectPostgres},
		{"/data/jarvis.db", DialectSQLite},
		{":memory:", DialectSQLite},
		{"./local.db", DialectSQLite},
	}
	for _, tc := range cases {
		if got := DetectDialect(tc.dsn); got != tc.want {
			t.Errorf("DetectDialect(%q) = %q, want %q", tc.dsn, got, tc.want)
		}
	}
}

func TestRedactDSN(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"postgres://user:secret@host:5432/db", "postgres://user:***@host:5432/db"},
		{"postgres://user@host/db", "postgres://user@host/db"},
		{"/data/jarvis.db", "/data/jarvis.db"},
	}
	for _, tc := range cases {
		if got := RedactDSN(tc.input); got != tc.want {
			t.Errorf("RedactDSN(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestMigrate_Idempotent(t *testing.T) {
	database, _, err := Open(":memory:")
	if err != nil {
		t.Fatalf("Open() error: %v", err)
	}
	defer func() { _ = database.Close() }()

	if err := Migrate(database, DialectSQLite); err != nil {
		t.Fatalf("first Migrate() error: %v", err)
	}
	if err := Migrate(database, DialectSQLite); err != nil {
		t.Fatalf("second Migrate() error: %v", err)
	}
}

func TestMigrate_TablesExist(t *testing.T) {
	database, _, err := Open(":memory:")
	if err != nil {
		t.Fatalf("Open() error: %v", err)
	}
	defer func() { _ = database.Close() }()

	if err := Migrate(database, DialectSQLite); err != nil {
		t.Fatalf("Migrate() error: %v", err)
	}

	tables := []string{
		"alert_fingerprints",
		"alert_events",
		"alert_comments",
		"alert_claims",
	}
	for _, table := range tables {
		var count int
		err := database.QueryRowContext(
			context.Background(),
			`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, table,
		).Scan(&count)
		if err != nil {
			t.Fatalf("check table %q: %v", table, err)
		}
		if count != 1 {
			t.Errorf("table %q not found after Migrate()", table)
		}
	}
}

func TestPragmas(t *testing.T) {
	database, _, err := Open(":memory:")
	if err != nil {
		t.Fatalf("Open() error: %v", err)
	}
	defer func() { _ = database.Close() }()

	var mode string
	if err := database.QueryRowContext(context.Background(), "PRAGMA journal_mode").Scan(&mode); err != nil {
		t.Fatalf("PRAGMA journal_mode: %v", err)
	}
	// In-memory SQLite always reports "memory" mode, not "wal" — that's expected.
	if mode != "memory" && mode != "wal" {
		t.Errorf("journal_mode = %q, want memory or wal", mode)
	}

	var fk int
	if err := database.QueryRowContext(context.Background(), "PRAGMA foreign_keys").Scan(&fk); err != nil {
		t.Fatalf("PRAGMA foreign_keys: %v", err)
	}
	if fk != 1 {
		t.Errorf("foreign_keys = %d, want 1", fk)
	}
}
