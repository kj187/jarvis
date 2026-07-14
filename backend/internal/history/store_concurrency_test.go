package history

import (
	"sync"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/models"
)

// TestRecordStatusChange_ConcurrentSQLite exercises D5: goroutines racing a
// status transition for the same episode through one Store. SQLite's
// single-writer connection (SetMaxOpenConns(1)) already serializes
// transactions at the connection-pool level, so this asserts the outcome is
// correct under -race, not that the advisory lock itself is exercised — that
// part is PostgreSQL-only, see TestRecordStatusChange_ConcurrentPostgres.
func TestRecordStatusChange_ConcurrentSQLite(t *testing.T) {
	s := newTestStore(t)
	runConcurrentResolveRace(t, []*Store{s, s})
}

// TestRecordStatusChange_ConcurrentPostgres is the regression test for D5:
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
