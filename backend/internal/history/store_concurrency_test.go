package history

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/models"
)

// TestRecordStatusChange_ConcurrentSQLite exercises Invariant #16: goroutines racing a
// status transition for the same episode through one Store. SQLite's
// single-writer connection (SetMaxOpenConns(1)) already serializes
// transactions at the connection-pool level, so this asserts the outcome is
// correct under -race, not that the advisory lock itself is exercised — that
// part is PostgreSQL-only, see TestRecordStatusChange_ConcurrentPostgres.
func TestRecordStatusChange_ConcurrentSQLite(t *testing.T) {
	s := newTestStore(t)
	runConcurrentResolveRace(t, []*Store{s, s})
}

// TestRecordStatusChange_ConcurrentPostgres is the regression test for Invariant #16:
// without pg_advisory_xact_lock, N Stores backed by separate connections can
// all read the same "last event" before any of them commits, and all decide
// to insert — producing duplicate resolved rows for one episode. Two racing
// connections rarely overlap widely enough on localhost to prove this (the
// full read→insert→commit round trip is sub-millisecond), so this uses 10
// concurrent Store instances to reliably force the overlap — confirmed by
// temporarily disabling the lock during development: 2 racers passed 20/20
// runs (false negative), 10 racers reproduced duplicates in >80% of runs.
// Gated on JARVIS_TEST_POSTGRES_DSN (see store_postgres_test.go).
func TestRecordStatusChange_ConcurrentPostgres(t *testing.T) {
	stores := newTestPostgresStores(t, 10)
	runConcurrentResolveRace(t, stores)
}

// runConcurrentResolveRace fires an alert, then resolves it concurrently
// through every given Store handle racing on the same (fingerprint,
// cluster). Exactly one resolved row must exist afterward — more would mean
// the idempotency check ran non-atomically with the insert.
func runConcurrentResolveRace(t *testing.T, stores []*Store) {
	t.Helper()
	const fp, cluster, amURL = "race-fp", "race-cluster", "http://am"

	if err := stores[0].UpsertFingerprint(fp, "RaceAlert", cluster, nil); err != nil {
		t.Fatalf("seed fingerprint: %v", err)
	}
	if _, _, err := stores[0].RecordStatusChange(fp, cluster, amURL, models.EventStatusFiring, time.Now(), nil); err != nil {
		t.Fatalf("seed firing: %v", err)
	}

	var wg sync.WaitGroup
	errs := make(chan error, len(stores))
	wg.Add(len(stores))
	for _, s := range stores {
		s := s
		go func() {
			defer wg.Done()
			_, _, err := s.RecordStatusChange(fp, cluster, amURL, models.EventStatusResolved, time.Now(), nil)
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent RecordStatusChange: %v", err)
		}
	}

	events, total, err := stores[0].GetHistoryForCluster(fp, cluster, 50, 0)
	if err != nil {
		t.Fatalf("GetHistoryForCluster: %v", err)
	}
	resolvedCount := 0
	for _, e := range events {
		if e.Status == models.EventStatusResolved {
			resolvedCount++
		}
	}
	if resolvedCount != 1 {
		t.Fatalf("expected exactly 1 resolved event, got %d (total events %d)", resolvedCount, total)
	}
}

// TestRecordResolvedForCluster_ConcurrentSQLite exercises Critical Invariant
// #16 for RecordResolvedForCluster: goroutines racing to resolve the same
// episode through one Store. SQLite's single-writer connection already
// serializes transactions at the connection-pool level, so this asserts the
// outcome is correct under -race, not that the advisory lock itself is
// exercised — see TestRecordResolvedForCluster_ConcurrentPostgres for that.
func TestRecordResolvedForCluster_ConcurrentSQLite(t *testing.T) {
	s := newTestStore(t)
	runConcurrentResolveForClusterRace(t, []*Store{s, s})
}

// TestRecordResolvedForCluster_ConcurrentPostgres is the regression test for
// Critical Invariant #16 on RecordResolvedForCluster: without
// pg_advisory_xact_lock, N Stores backed by separate connections — e.g. a
// failover racing reconcileStartupResolves against the newly promoted
// leader's own applyPollResults — can all read the same "last event" before
// any of them commits, and all decide to insert, producing duplicate
// resolved rows for one episode. Same 10-racer rationale as
// TestRecordStatusChange_ConcurrentPostgres.
func TestRecordResolvedForCluster_ConcurrentPostgres(t *testing.T) {
	stores := newTestPostgresStores(t, 10)
	runConcurrentResolveForClusterRace(t, stores)
}

// runConcurrentResolveForClusterRace fires an alert, then calls
// RecordResolvedForCluster concurrently through every given Store handle
// racing on the same (fingerprint, cluster). Exactly one resolved row must
// exist afterward — more would mean the read-last/no-op-if-resolved check
// ran non-atomically with the insert.
func runConcurrentResolveForClusterRace(t *testing.T, stores []*Store) {
	t.Helper()
	const fp, cluster, amURL = "resolve-race-fp", "resolve-race-cluster", "http://am"

	if err := stores[0].UpsertFingerprint(fp, "ResolveRaceAlert", cluster, nil); err != nil {
		t.Fatalf("seed fingerprint: %v", err)
	}
	if _, _, err := stores[0].RecordStatusChange(fp, cluster, amURL, models.EventStatusFiring, time.Now(), nil); err != nil {
		t.Fatalf("seed firing: %v", err)
	}

	var wg sync.WaitGroup
	errs := make(chan error, len(stores))
	wg.Add(len(stores))
	for _, s := range stores {
		s := s
		go func() {
			defer wg.Done()
			errs <- s.RecordResolvedForCluster(fp, cluster, time.Now())
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent RecordResolvedForCluster: %v", err)
		}
	}

	events, total, err := stores[0].GetHistoryForCluster(fp, cluster, 50, 0)
	if err != nil {
		t.Fatalf("GetHistoryForCluster: %v", err)
	}
	resolvedCount := 0
	for _, e := range events {
		if e.Status == models.EventStatusResolved {
			resolvedCount++
		}
	}
	if resolvedCount != 1 {
		t.Fatalf("expected exactly 1 resolved event, got %d (total events %d)", resolvedCount, total)
	}
}

// TestRecordStatusChange_AdvisoryLockTimeout_Postgres is the regression test
// for BUG-04: RecordStatusChange used to run its whole transaction —
// including the pg_advisory_xact_lock wait — on context.Background(), so a
// peer stuck holding the same episode's lock (a hung pod, a transaction
// stranded by a network partition) blocked it forever. Since that call runs
// sequentially in applyPollResults, a single stuck episode stalled the
// entire poll loop permanently: no further polls, no poll_snapshots
// updates, no WS broadcasts, and no shutdown could unblock it either.
//
// Here a raw connection holds the episode's advisory lock open in an
// uncommitted transaction, simulating that stuck peer. RecordStatusChange
// for the same (fingerprint, cluster) must still return — with an error —
// well within txTimeout, and specifically within lock_timeout (10s), which
// is set as the transaction's first statement precisely so the wait aborts
// deterministically instead of relying solely on context cancellation.
func TestRecordStatusChange_AdvisoryLockTimeout_Postgres(t *testing.T) {
	stores := newTestPostgresStores(t, 2)
	const fp, cluster, amURL = "lock-timeout-fp", "lock-timeout-cluster", "http://am"

	if err := stores[0].UpsertFingerprint(fp, "LockTimeoutAlert", cluster, nil); err != nil {
		t.Fatalf("seed fingerprint: %v", err)
	}
	if _, _, err := stores[0].RecordStatusChange(fp, cluster, amURL, models.EventStatusFiring, time.Now(), nil); err != nil {
		t.Fatalf("seed firing: %v", err)
	}

	holderConn, err := stores[0].db.Conn(context.Background())
	if err != nil {
		t.Fatalf("acquire raw conn: %v", err)
	}
	defer func() { _ = holderConn.Close() }()
	holderTx, err := holderConn.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin holder tx: %v", err)
	}
	defer func() { _ = holderTx.Rollback() }()
	if _, err := holderTx.ExecContext(context.Background(),
		`SELECT pg_advisory_xact_lock(hashtext($1))`, fp+":"+cluster,
	); err != nil {
		t.Fatalf("acquire holder lock: %v", err)
	}

	done := make(chan error, 1)
	start := time.Now()
	go func() {
		_, _, err := stores[1].RecordStatusChange(fp, cluster, amURL, models.EventStatusResolved, time.Now(), nil)
		done <- err
	}()

	select {
	case err := <-done:
		elapsed := time.Since(start)
		if err == nil {
			t.Fatal("expected RecordStatusChange to fail while the episode's advisory lock is held, got nil error")
		}
		if elapsed >= txTimeout {
			t.Fatalf("RecordStatusChange took %s to fail — expected lock_timeout (10s) to abort it before the outer txTimeout (%s)", elapsed, txTimeout)
		}
		t.Logf("RecordStatusChange failed after %s as expected: %v", elapsed, err)
	case <-time.After(txTimeout + 15*time.Second):
		t.Fatal("RecordStatusChange did not return within txTimeout+buffer — the advisory lock wait is unbounded again (BUG-04 regression)")
	}
}
