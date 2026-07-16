package db

import (
	"context"
	"os"
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

func TestOpen_SQLite_IgnoresMaxOpenConns(t *testing.T) {
	// SQLite must stay single-writer (AGENTS.md invariant 8) no matter what
	// pool size the caller asks for.
	database, _, err := Open(":memory:", WithMaxOpenConns(50))
	if err != nil {
		t.Fatalf("Open() error: %v", err)
	}
	defer func() { _ = database.Close() }()

	if got := database.Stats().MaxOpenConnections; got != 1 {
		t.Errorf("MaxOpenConnections = %d, want 1", got)
	}
}

// TestOpen_Postgres_PoolLimits is env-gated (JARVIS_TEST_POSTGRES_DSN):
// an unbounded pool exhausted RDS connection slots in production
// (SQLSTATE 53300), so openPostgres must always cap the pool.
func TestOpen_Postgres_PoolLimits(t *testing.T) {
	dsn := os.Getenv("JARVIS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("JARVIS_TEST_POSTGRES_DSN not set — skipping PostgreSQL-backed test")
	}

	t.Run("default", func(t *testing.T) {
		database, _, err := openPostgres(dsn, defaultPoolConfig())
		if err != nil {
			t.Fatalf("openPostgres() error: %v", err)
		}
		defer func() { _ = database.Close() }()

		if got := database.Stats().MaxOpenConnections; got != defaultMaxOpenConns {
			t.Errorf("MaxOpenConnections = %d, want %d", got, defaultMaxOpenConns)
		}
	})

	t.Run("custom", func(t *testing.T) {
		cfg := defaultPoolConfig()
		WithMaxOpenConns(3)(&cfg)
		database, _, err := openPostgres(dsn, cfg)
		if err != nil {
			t.Fatalf("openPostgres() error: %v", err)
		}
		defer func() { _ = database.Close() }()

		if got := database.Stats().MaxOpenConnections; got != 3 {
			t.Errorf("MaxOpenConnections = %d, want 3", got)
		}
	})
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

// TestMigrate_Postgres_PollSnapshotsTableExists is env-gated (JARVIS_TEST_POSTGRES_DSN):
// poll_snapshots is PostgreSQL-only (docs/persistence.md D3) — never
// created on SQLite.
func TestMigrate_Postgres_PollSnapshotsTableExists(t *testing.T) {
	dsn := os.Getenv("JARVIS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("JARVIS_TEST_POSTGRES_DSN not set — skipping PostgreSQL-backed test")
	}
	// openPostgres directly (not the dialect-dispatching Open) — this test is
	// always PostgreSQL, and Open's SQLite branch reaching os.MkdirAll(path)
	// on a value derived from JARVIS_TEST_POSTGRES_DSN otherwise trips gosec's
	// taint analysis (G703) even though that branch can never execute here.
	database, dialect, err := openPostgres(dsn, defaultPoolConfig())
	if err != nil {
		t.Fatalf("openPostgres() error: %v", err)
	}
	defer func() { _ = database.Close() }()

	if err := Migrate(database, dialect); err != nil {
		t.Fatalf("Migrate() error: %v", err)
	}

	var count int
	err = database.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'poll_snapshots'`,
	).Scan(&count)
	if err != nil {
		t.Fatalf("check poll_snapshots table: %v", err)
	}
	if count != 1 {
		t.Error("poll_snapshots table not found after Migrate() on PostgreSQL")
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
