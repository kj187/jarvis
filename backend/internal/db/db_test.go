package db

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"
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
		// global_settings: Phase 0 of the RBAC label-scoped-access plan
		// (per-section admin settings, key = section name).
		"global_settings",
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

// TestMigrate_SQLite_IndexesExist guards four retention-sweep indices found
// by reviewing store_retention.go against this schema: DeleteCommentsBefore,
// DeleteReleasedClaimsBefore, DeleteSilenceEventsBefore and
// DeleteOrphanFingerprintsBefore each filtered a column with no index at all,
// or one whose leading column didn't match the filter — confirmed via
// EXPLAIN (ANALYZE, BUFFERS) against a local PostgreSQL instance seeded with
// a realistic retention-sweep shape (most rows recent, a small aged tail):
// each went from a full sequential scan to a bitmap/plain index scan.
//
// The "latest event per (fingerprint, cluster_name)" CTE in
// GetAllResolved/visitResolved was also reviewed as a candidate, but ruled
// out: that CTE aggregates over the unfiltered whole alert_events table
// (MAX(id) GROUP BY fingerprint, cluster_name, no WHERE), and EXPLAIN ANALYZE
// at up to 660k rows showed PostgreSQL never chooses an index for it — a
// full-table aggregate has to touch every row either way, and a seq scan +
// hash aggregate reads that cheaper than a b-tree of the same size. Adding
// one there would be pure write overhead on every alert_events insert with
// no read benefit. The actual fix is pushing the fingerprint/cluster/After
// predicates into the CTE itself (safe; the Through upper bound must stay
// outer or it breaks the "excludes re-fired alerts" guarantee) — a query-
// semantics change against a tested critical invariant, not an index, and
// deliberately left for a separate, carefully tested change.
func TestMigrate_SQLite_IndexesExist(t *testing.T) {
	database, _, err := Open(":memory:")
	if err != nil {
		t.Fatalf("Open() error: %v", err)
	}
	defer func() { _ = database.Close() }()

	if err := Migrate(database, DialectSQLite); err != nil {
		t.Fatalf("Migrate() error: %v", err)
	}

	for _, idx := range []string{
		"idx_alert_comments_created_at",
		"idx_alert_claims_released_at",
		"idx_silence_events_recorded_at",
		"idx_alert_fingerprints_last_seen_at",
	} {
		var count int
		err := database.QueryRowContext(
			context.Background(),
			`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?`, idx,
		).Scan(&count)
		if err != nil {
			t.Fatalf("check index %q: %v", idx, err)
		}
		if count != 1 {
			t.Errorf("index %q not found after Migrate()", idx)
		}
	}
}

// TestMigrate_Postgres_IndexesExist is env-gated (JARVIS_TEST_POSTGRES_DSN) —
// see TestMigrate_SQLite_IndexesExist's doc comment for why these indices
// exist.
func TestMigrate_Postgres_IndexesExist(t *testing.T) {
	dsn := os.Getenv("JARVIS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("JARVIS_TEST_POSTGRES_DSN not set — skipping PostgreSQL-backed test")
	}

	database, dialect, err := openPostgres(dsn, defaultPoolConfig())
	if err != nil {
		t.Fatalf("openPostgres() error: %v", err)
	}
	defer func() { _ = database.Close() }()

	if err := Migrate(database, dialect); err != nil {
		t.Fatalf("Migrate() error: %v", err)
	}

	for _, idx := range []string{
		"idx_alert_comments_created_at",
		"idx_alert_claims_released_at",
		"idx_silence_events_recorded_at",
		"idx_alert_fingerprints_last_seen_at",
	} {
		var count int
		err := database.QueryRowContext(
			context.Background(),
			`SELECT COUNT(*) FROM pg_indexes WHERE indexname = $1`, idx,
		).Scan(&count)
		if err != nil {
			t.Fatalf("check index %q: %v", idx, err)
		}
		if count != 1 {
			t.Errorf("index %q not found after Migrate() on PostgreSQL", idx)
		}
	}
}

// TestMigrate_Postgres_PollSnapshotsTableExists is env-gated (JARVIS_TEST_POSTGRES_DSN):
// poll_snapshots is PostgreSQL-only (docs/postgres-ha.md D3) — never
// created on SQLite.
func TestMigrate_Postgres_PollSnapshotsTableExists(t *testing.T) { //nolint:dupl // same shape as TestMigrate_Postgres_GlobalSettingsTableExists on purpose; one table check per test reads clearer than parameterizing two
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

// TestMigrate_Postgres_GlobalSettingsTableExists is env-gated
// (JARVIS_TEST_POSTGRES_DSN): global_settings (Phase 0 of the RBAC
// label-scoped-access plan) must exist on PostgreSQL too, not just SQLite —
// TestMigrate_TablesExist only exercises the SQLite migration path.
func TestMigrate_Postgres_GlobalSettingsTableExists(t *testing.T) { //nolint:dupl // same shape as TestMigrate_Postgres_PollSnapshotsTableExists on purpose; one table check per test reads clearer than parameterizing two
	dsn := os.Getenv("JARVIS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("JARVIS_TEST_POSTGRES_DSN not set — skipping PostgreSQL-backed test")
	}
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
		`SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'global_settings'`,
	).Scan(&count)
	if err != nil {
		t.Fatalf("check global_settings table: %v", err)
	}
	if count != 1 {
		t.Error("global_settings table not found after Migrate() on PostgreSQL")
	}
}

// TestMigrate_Postgres_SerializesConcurrentMigrations is env-gated
// (JARVIS_TEST_POSTGRES_DSN): every pod runs Migrate() independently on
// startup, before leader election begins, so two pods racing
// `CREATE TABLE IF NOT EXISTS` during a rolling deploy must not run
// concurrently — see migrationLockClassID/migrationLockID in
// migrate_postgres.go. This test holds that same advisory lock on a
// separate connection (simulating a pod already migrating) and asserts a
// concurrent Migrate() call blocks until the lock is released, then
// completes successfully.
// TestMigrate_Postgres_ConnErrorPropagates exercises migratePostgres's
// connection-acquire error path without needing a live PostgreSQL instance:
// dialing a closed local port fails fast and deterministically.
func TestMigrate_Postgres_ConnErrorPropagates(t *testing.T) {
	database, err := sql.Open("pgx", "postgres://user:pass@127.0.0.1:1/nonexistent?sslmode=disable&connect_timeout=1")
	if err != nil {
		t.Fatalf("sql.Open() error: %v", err)
	}
	defer func() { _ = database.Close() }()

	if err := Migrate(database, DialectPostgres); err == nil {
		t.Fatal("Migrate() error = nil, want a connection error")
	}
}

func TestMigrate_Postgres_SerializesConcurrentMigrations(t *testing.T) {
	dsn := os.Getenv("JARVIS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("JARVIS_TEST_POSTGRES_DSN not set — skipping PostgreSQL-backed test")
	}

	database, dialect, err := openPostgres(dsn, defaultPoolConfig())
	if err != nil {
		t.Fatalf("openPostgres() error: %v", err)
	}
	defer func() { _ = database.Close() }()

	ctx := context.Background()
	holder, err := database.Conn(ctx)
	if err != nil {
		t.Fatalf("acquire holder connection: %v", err)
	}
	defer func() { _ = holder.Close() }()

	if _, err := holder.ExecContext(ctx, `SELECT pg_advisory_lock($1, $2)`, migrationLockClassID, migrationLockID); err != nil {
		t.Fatalf("holder acquire migration lock: %v", err)
	}

	done := make(chan error, 1)
	go func() { done <- Migrate(database, dialect) }()

	select {
	case err := <-done:
		t.Fatalf("Migrate() returned (err=%v) while the migration lock was still held by another connection — it is not serializing concurrent migrations", err)
	case <-time.After(300 * time.Millisecond):
		// Expected: Migrate() is blocked waiting for the lock.
	}

	if _, err := holder.ExecContext(ctx, `SELECT pg_advisory_unlock($1, $2)`, migrationLockClassID, migrationLockID); err != nil {
		t.Fatalf("holder release migration lock: %v", err)
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Migrate() error after lock released: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Migrate() did not complete after the migration lock was released")
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
