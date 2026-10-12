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

	clock = clock.Add(time.Minute)
	time.Sleep(2 * time.Millisecond)
	rec.processAlerts(ctx, alerts)
	second, _ := fingerprintLastSeen(t, rec.store, "fp1")
	if !second.Equal(first) {
		t.Fatalf("second poll rewrote the fingerprint row: last_seen_at %v -> %v", first, second)
	}

	clock = clock.Add(fingerprintTouchInterval)
	time.Sleep(2 * time.Millisecond)
	rec.processAlerts(ctx, alerts)
	third, _ := fingerprintLastSeen(t, rec.store, "fp1")
	if !third.After(first) {
		t.Fatalf("last_seen_at not refreshed after the touch interval: %v -> %v", first, third)
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
