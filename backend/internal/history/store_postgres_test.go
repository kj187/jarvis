package history

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	idb "github.com/kj187/jarvis/backend/internal/db"
)

// postgresTestDSN returns the PostgreSQL test DSN from JARVIS_TEST_POSTGRES_DSN,
// or skips the calling test if unset. This gates every PostgreSQL-backed test
// in this package so `go test ./...` stays green without a database — CI
// provisions one (see .github/workflows/ci.yml); locally use `make up-postgres`
// and export JARVIS_TEST_POSTGRES_DSN=postgres://jarvis:jarvis@localhost:5432/jarvis?sslmode=disable.
func postgresTestDSN(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("JARVIS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("JARVIS_TEST_POSTGRES_DSN not set — skipping PostgreSQL-backed test")
	}
	return dsn
}

// newTestPostgresStores opens n independent *sql.DB connections against the
// same PostgreSQL test database — n Store instances sharing one database,
// the multi-replica situation in miniature that later slices' elector/
// recorder/fanout tests will reuse this same pattern for. Tables are
// truncated up front so a test doesn't see leftovers from a previous run.
func newTestPostgresStores(t *testing.T, n int) []*Store {
	t.Helper()
	dsn := postgresTestDSN(t)

	setup, dialect, err := idb.Open(dsn)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	if err := idb.Migrate(setup, dialect); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if _, err := setup.ExecContext(context.Background(),
		`TRUNCATE alert_events, alert_fingerprints, alert_claims, alert_comments, poll_snapshots RESTART IDENTITY CASCADE`,
	); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	if err := setup.Close(); err != nil {
		t.Fatalf("close setup conn: %v", err)
	}

	stores := make([]*Store, n)
	for i := 0; i < n; i++ {
		database, dialect, err := idb.Open(dsn)
		if err != nil {
			t.Fatalf("open postgres (%d): %v", i, err)
		}
		t.Cleanup(func() { _ = database.Close() })
		stores[i] = NewStore(database, dialect)
	}
	return stores
}

// dialRawListener opens a dedicated pgx connection, issues LISTEN <channel>,
// and returns it for waitForNotification — a minimal LISTEN client
// independent of Recorder's own listener machinery, used to verify
// Store.NotifySnapshotChanged/NotifyTrigger actually deliver over the wire.
func dialRawListener(t *testing.T, dsn, channel string) *pgx.Conn {
	t.Helper()
	conn, err := pgx.Connect(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect for LISTEN %s: %v", channel, err)
	}
	if _, err := conn.Exec(context.Background(), "LISTEN "+channel); err != nil {
		t.Fatalf("LISTEN %s: %v", channel, err)
	}
	t.Cleanup(func() { _ = conn.Close(context.Background()) })
	return conn
}

// waitForNotification blocks until a notification arrives on conn's LISTEN-ed
// channel(s) or timeout elapses (failing the test in the latter case).
func waitForNotification(t *testing.T, conn *pgx.Conn, timeout time.Duration) *pgconn.Notification {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	n, err := conn.WaitForNotification(ctx)
	if err != nil {
		t.Fatalf("WaitForNotification: %v", err)
	}
	return n
}
