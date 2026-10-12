package history

import (
	"context"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/models"
)

func fingerprintLastSeen(t *testing.T, store *Store, fingerprint string) (time.Time, bool) {
	t.Helper()
	rows, err := store.query(context.Background(),
		`SELECT last_seen_at FROM alert_fingerprints WHERE fingerprint = ?`, fingerprint)
	if err != nil {
		t.Fatalf("query last_seen_at: %v", err)
	}
	defer func() { _ = rows.Close() }()
	if !rows.Next() {
		return time.Time{}, false
	}
	var lastSeen time.Time
	if err := rows.Scan(&lastSeen); err != nil {
		t.Fatalf("scan last_seen_at: %v", err)
	}
	return lastSeen, true
}

// An alert that stays active is seen again on every poll. Rewriting its
// alert_fingerprints row each time is one row version, one index entry and
// one WAL record per alert per poll for a timestamp only retention reads.
func TestRecorder_ActiveAlertDoesNotRewriteFingerprintEveryPoll(t *testing.T) {
	rec, _ := newTestRecorder(t)
	clock := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	rec.now = func() time.Time { return clock }
	ctx := context.Background()
	alerts := []models.EnrichedAlert{makeEnrichedAlert("fp1", "active", "homelab")}

	rec.processAlerts(ctx, alerts)
	first, ok := fingerprintLastSeen(t, rec.store, "fp1")
	if !ok {
		t.Fatal("first poll wrote no fingerprint row")
	}

	if !first.Equal(clock) {
		t.Fatalf("last_seen_at = %v, want the recorder clock %v", first, clock)
	}

	clock = clock.Add(time.Minute)
	rec.processAlerts(ctx, alerts)
	second, _ := fingerprintLastSeen(t, rec.store, "fp1")
	if !second.Equal(first) {
		t.Fatalf("second poll rewrote the fingerprint row: last_seen_at %v -> %v", first, second)
	}

	clock = clock.Add(fingerprintTouchInterval)
	rec.processAlerts(ctx, alerts)
	third, _ := fingerprintLastSeen(t, rec.store, "fp1")
	if !third.Equal(clock) {
		t.Fatalf("last_seen_at after the touch interval = %v, want %v", third, clock)
	}
}

// A fingerprint row can go missing behind the Store's back (manual SQL, a
// restore while running). The event insert then fails on the foreign key;
// the very next poll must write the row again instead of waiting an hour.
func TestRecorder_MissingFingerprintRowHealsOnNextPoll(t *testing.T) {
	rec, _ := newTestRecorder(t)
	clock := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	rec.now = func() time.Time { return clock }
	ctx := context.Background()
	alerts := []models.EnrichedAlert{makeEnrichedAlert("fp1", "active", "homelab")}

	rec.processAlerts(ctx, alerts)
	for _, table := range []string{"alert_events", "alert_fingerprints"} {
		if _, err := rec.store.exec(ctx, "DELETE FROM "+table); err != nil {
			t.Fatalf("delete %s: %v", table, err)
		}
	}

	clock = clock.Add(time.Minute)
	rec.processAlerts(ctx, alerts) // event insert fails: no fingerprint row
	clock = clock.Add(time.Minute)
	rec.processAlerts(ctx, alerts)

	if _, ok := fingerprintLastSeen(t, rec.store, "fp1"); !ok {
		t.Fatal("fingerprint row still missing two polls after it was deleted")
	}
	events, _, err := rec.store.GetHistory("fp1", 10, 0)
	if err != nil || len(events) != 1 {
		t.Fatalf("GetHistory = %d events, %v; want the firing event recorded again", len(events), err)
	}
}

func TestTouchFingerprint_FailedWriteLeavesNoMark(t *testing.T) {
	rec, _ := newTestRecorder(t)
	store := rec.store
	if err := store.db.Close(); err != nil {
		t.Fatalf("close db: %v", err)
	}
	now := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	if err := store.TouchFingerprint("fp1", "TestAlert", "homelab", nil, now); err == nil {
		t.Fatal("TouchFingerprint on a closed database returned no error")
	}
	store.touchMu.Lock()
	defer store.touchMu.Unlock()
	if len(store.touched) != 0 {
		t.Fatalf("a failed write left a mark: %v", store.touched)
	}
}

func TestTouchFingerprint_ClockGoingBackwardsWritesAgain(t *testing.T) {
	rec, _ := newTestRecorder(t)
	store := rec.store
	now := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	if err := store.TouchFingerprint("fp1", "TestAlert", "homelab", nil, now); err != nil {
		t.Fatalf("TouchFingerprint: %v", err)
	}
	earlier := now.Add(-time.Minute)
	if err := store.TouchFingerprint("fp1", "TestAlert", "homelab", nil, earlier); err != nil {
		t.Fatalf("TouchFingerprint: %v", err)
	}
	if got, _ := fingerprintLastSeen(t, store, "fp1"); !got.Equal(earlier) {
		t.Fatalf("last_seen_at = %v, want the row rewritten at %v", got, earlier)
	}
}

// Deleting fingerprint rows and writing them race in the e2e reset: the row
// is written, the delete removes it and drops the marks, and only then does
// the writer record its mark. That late mark must not stick.
func TestTouchFingerprint_MarkFromBeforeADeleteIsDiscarded(t *testing.T) {
	rec, _ := newTestRecorder(t)
	store := rec.store
	now := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)

	gen, due := store.fingerprintTouchDue("fp1", now)
	if !due {
		t.Fatal("an unknown fingerprint is not due")
	}
	if err := store.upsertFingerprintAt("fp1", "TestAlert", "homelab", nil, now); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if _, err := store.exec(context.Background(), `DELETE FROM alert_fingerprints`); err != nil {
		t.Fatalf("delete fingerprints: %v", err)
	}
	store.forgetTouchedFingerprints()
	store.markFingerprintTouched("fp1", now, gen)

	if _, due := store.fingerprintTouchDue("fp1", now.Add(time.Minute)); !due {
		t.Fatal("fingerprint is marked as written although its row was deleted")
	}
}

func TestTouchFingerprint_Postgres(t *testing.T) {
	store := newTestPostgresStores(t, 1)[0]
	now := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	labels := map[string]string{"alertname": "TestAlert"}

	if err := store.TouchFingerprint("fp1", "TestAlert", "homelab", labels, now); err != nil {
		t.Fatalf("TouchFingerprint: %v", err)
	}
	if err := store.TouchFingerprint("fp1", "TestAlert", "homelab", labels, now.Add(time.Minute)); err != nil {
		t.Fatalf("TouchFingerprint within the interval: %v", err)
	}
	if got, _ := fingerprintLastSeen(t, store, "fp1"); !got.Equal(now) {
		t.Fatalf("last_seen_at = %v, want %v untouched within the interval", got, now)
	}
	later := now.Add(fingerprintTouchInterval)
	if err := store.TouchFingerprint("fp1", "TestAlert", "homelab", labels, later); err != nil {
		t.Fatalf("TouchFingerprint after the interval: %v", err)
	}
	if got, _ := fingerprintLastSeen(t, store, "fp1"); !got.Equal(later) {
		t.Fatalf("last_seen_at = %v, want %v", got, later)
	}
}

func TestTouchFingerprint_RewritesRowDeletedByRetention(t *testing.T) {
	rec, _ := newTestRecorder(t)
	store := rec.store
	now := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	labels := map[string]string{"alertname": "TestAlert"}

	if err := store.TouchFingerprint("fp1", "TestAlert", "homelab", labels, now); err != nil {
		t.Fatalf("TouchFingerprint: %v", err)
	}
	deleted, err := store.DeleteOrphanFingerprintsBefore(context.Background(), time.Now().Add(time.Hour), 100)
	if err != nil || deleted != 1 {
		t.Fatalf("DeleteOrphanFingerprintsBefore = %d, %v; want 1, nil", deleted, err)
	}

	// Still inside the touch interval: the row is gone, so it must be written again.
	if err := store.TouchFingerprint("fp1", "TestAlert", "homelab", labels, now.Add(time.Minute)); err != nil {
		t.Fatalf("TouchFingerprint after sweep: %v", err)
	}
	if _, ok := fingerprintLastSeen(t, store, "fp1"); !ok {
		t.Fatal("fingerprint row missing after it was swept and seen again")
	}
}

func TestTouchFingerprint_ForgetsEntriesOlderThanInterval(t *testing.T) {
	rec, _ := newTestRecorder(t)
	store := rec.store
	now := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	labels := map[string]string{"alertname": "TestAlert"}

	if err := store.TouchFingerprint("gone", "TestAlert", "homelab", labels, now); err != nil {
		t.Fatalf("TouchFingerprint: %v", err)
	}
	later := now.Add(2 * fingerprintTouchInterval)
	if err := store.TouchFingerprint("current", "TestAlert", "homelab", labels, later); err != nil {
		t.Fatalf("TouchFingerprint: %v", err)
	}

	store.touchMu.Lock()
	defer store.touchMu.Unlock()
	if _, kept := store.touched["gone"]; kept {
		t.Error("entry of a fingerprint not seen for two intervals was kept")
	}
	if _, kept := store.touched["current"]; !kept {
		t.Error("entry of the fingerprint just written is missing")
	}
}
