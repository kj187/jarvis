package history

import (
	"context"
	"testing"
	"time"

	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/models"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	database, dialect, err := idb.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := idb.Migrate(database, dialect); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return NewStore(database, dialect)
}

func TestUpsertFingerprint(t *testing.T) {
	s := newTestStore(t)

	labels := map[string]string{"alertname": "TestAlert", "severity": "critical"}
	if err := s.UpsertFingerprint("fp1", "TestAlert", "homelab", labels); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}

	st, err := s.GetStats("fp1")
	if err != nil {
		t.Fatalf("GetStats: %v", err)
	}
	if st == nil {
		t.Fatal("expected stats, got nil")
	}
	if st.OccurrenceCount != 1 {
		t.Errorf("OccurrenceCount = %d, want 1", st.OccurrenceCount)
	}
}

func TestUpsertFingerprint_UpdatesLastSeenAt(t *testing.T) {
	s := newTestStore(t)

	labels := map[string]string{"alertname": "TestAlert"}
	if err := s.UpsertFingerprint("fp1", "TestAlert", "homelab", labels); err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	st1, _ := s.GetStats("fp1")

	time.Sleep(10 * time.Millisecond)
	if err := s.UpsertFingerprint("fp1", "TestAlert", "homelab", labels); err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	st2, _ := s.GetStats("fp1")

	if !st2.LastSeenAt.After(st1.LastSeenAt) {
		t.Error("second upsert did not update last_seen_at")
	}
	// occurrence_count must NOT be incremented by UpsertFingerprint
	if st2.OccurrenceCount != 1 {
		t.Errorf("OccurrenceCount after upsert = %d, want 1", st2.OccurrenceCount)
	}
}

func TestRecordStatusChange_CreatesNew(t *testing.T) {
	s := newTestStore(t)

	labels := map[string]string{"alertname": "TestAlert"}
	if err := s.UpsertFingerprint("fp1", "TestAlert", "homelab", labels); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	ev, err := s.RecordStatusChange("fp1", "homelab", "http://am:9093", models.EventStatusFiring, time.Now(), nil)
	if err != nil {
		t.Fatalf("RecordStatusChange: %v", err)
	}
	if ev.ID == 0 {
		t.Error("expected non-zero event ID")
	}
	if ev.Status != models.EventStatusFiring {
		t.Errorf("Status = %q, want firing", ev.Status)
	}
}

func TestRecordStatusChange_Idempotent(t *testing.T) {
	s := newTestStore(t)

	s.UpsertFingerprint("fp1", "TestAlert", "homelab", nil) //nolint:errcheck

	ev1, err := s.RecordStatusChange("fp1", "homelab", "http://am:9093", models.EventStatusFiring, time.Now(), nil)
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	ev2, err := s.RecordStatusChange("fp1", "homelab", "http://am:9093", models.EventStatusFiring, time.Now(), nil)
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if ev1.ID != ev2.ID {
		t.Errorf("idempotent: expected same event ID (%d), got %d", ev1.ID, ev2.ID)
	}
}

func TestRecordStatusChange_GracePeriod(t *testing.T) {
	s := newTestStore(t)

	s.UpsertFingerprint("fp1", "TestAlert", "homelab", nil) //nolint:errcheck

	// Create firing event, then immediately resolve it.
	ev1, err := s.RecordStatusChange("fp1", "homelab", "http://am:9093", models.EventStatusFiring, time.Now(), nil)
	if err != nil {
		t.Fatalf("firing: %v", err)
	}
	if err := s.RecordResolved("fp1", time.Now()); err != nil {
		t.Fatalf("resolve: %v", err)
	}

	// Re-fire within grace period (< 60s) — must return the original firing row,
	// not create a new one, and the resolved row must be deleted.
	ev2, err := s.RecordStatusChange("fp1", "homelab", "http://am:9093", models.EventStatusFiring, time.Now(), nil)
	if err != nil {
		t.Fatalf("refire: %v", err)
	}
	if ev1.ID != ev2.ID {
		t.Errorf("grace period: expected original firing ID (%d), got %d", ev1.ID, ev2.ID)
	}

	// Only one row should remain (the resolved row was deleted).
	events, total, _ := s.GetHistory("fp1", 10, 0)
	if total != 1 {
		t.Errorf("grace period: expected 1 row in DB, got %d", total)
	}
	if events[0].Status != models.EventStatusFiring {
		t.Errorf("remaining row status = %q, want firing", events[0].Status)
	}
}

func TestRecordStatusChange_GracePeriodExpired(t *testing.T) {
	s := newTestStore(t)

	s.UpsertFingerprint("fp1", "TestAlert", "homelab", nil) //nolint:errcheck

	// Insert firing and resolved directly with controlled recorded_at so that
	// resolved (now-90s) is newer than firing (now-3m) → getLastEvent returns resolved,
	// and 90s > 60s grace period → no grace-period deletion.
	s.db.ExecContext(context.Background(), //nolint:errcheck
		`INSERT INTO alert_events (fingerprint, cluster_name, alertmanager_url, status, starts_at, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`,
		"fp1", "homelab", "http://am:9093", "firing",
		time.Now().Add(-5*time.Minute), time.Now().Add(-3*time.Minute),
	)
	s.db.ExecContext(context.Background(), //nolint:errcheck
		`INSERT INTO alert_events (fingerprint, cluster_name, alertmanager_url, status, starts_at, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`,
		"fp1", "homelab", "http://am:9093", "resolved",
		time.Now().Add(-5*time.Minute), time.Now().Add(-90*time.Second),
	)

	// Re-fire outside grace period → new firing row + occurrence_count increment.
	ev, err := s.RecordStatusChange("fp1", "homelab", "http://am:9093", models.EventStatusFiring, time.Now(), nil)
	if err != nil {
		t.Fatalf("refire: %v", err)
	}
	if ev.Status != models.EventStatusFiring {
		t.Errorf("Status = %q, want firing", ev.Status)
	}

	st, _ := s.GetStats("fp1")
	if st == nil {
		t.Fatal("stats nil")
	}
	if st.OccurrenceCount != 2 {
		t.Errorf("OccurrenceCount = %d, want 2", st.OccurrenceCount)
	}
}

func TestRecordStatusChange_Transitions(t *testing.T) {
	s := newTestStore(t)

	s.UpsertFingerprint("fp1", "TestAlert", "homelab", nil) //nolint:errcheck
	now := time.Now()

	transitions := []string{
		models.EventStatusFiring,
		models.EventStatusSuppressed,
		models.EventStatusExpired,
		models.EventStatusFiring,
	}
	var ids []int64
	for _, status := range transitions {
		ev, err := s.RecordStatusChange("fp1", "homelab", "http://am:9093", status, now, nil)
		if err != nil {
			t.Fatalf("RecordStatusChange(%s): %v", status, err)
		}
		ids = append(ids, ev.ID)
	}

	// All IDs must be distinct (each transition = new row).
	seen := map[int64]bool{}
	for _, id := range ids {
		if seen[id] {
			t.Errorf("duplicate event ID %d in transition sequence", id)
		}
		seen[id] = true
	}

	events, total, _ := s.GetHistory("fp1", 10, 0)
	if total != 4 {
		t.Errorf("expected 4 rows, got %d", total)
	}
	// Newest first — last transition (firing) is at index 0.
	if events[0].Status != models.EventStatusFiring {
		t.Errorf("events[0].Status = %q, want firing", events[0].Status)
	}
}

func TestOccurrenceCount_IncrementOnRefiring(t *testing.T) {
	s := newTestStore(t)

	s.UpsertFingerprint("fp1", "TestAlert", "homelab", nil) //nolint:errcheck

	// Insert firing and resolved directly with controlled recorded_at so that
	// resolved (now-90s) is newer than firing (now-3m) → getLastEvent returns resolved,
	// and 90s > 60s grace period → no grace-period deletion.
	s.db.ExecContext(context.Background(), //nolint:errcheck
		`INSERT INTO alert_events (fingerprint, cluster_name, alertmanager_url, status, starts_at, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`,
		"fp1", "homelab", "http://am:9093", "firing",
		time.Now().Add(-5*time.Minute), time.Now().Add(-3*time.Minute),
	)
	s.db.ExecContext(context.Background(), //nolint:errcheck
		`INSERT INTO alert_events (fingerprint, cluster_name, alertmanager_url, status, starts_at, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`,
		"fp1", "homelab", "http://am:9093", "resolved",
		time.Now().Add(-5*time.Minute), time.Now().Add(-90*time.Second),
	)

	// Second firing → must increment occurrence_count.
	s.RecordStatusChange("fp1", "homelab", "http://am:9093", models.EventStatusFiring, time.Now(), nil) //nolint:errcheck

	st, _ := s.GetStats("fp1")
	if st == nil {
		t.Fatal("stats nil")
	}
	if st.OccurrenceCount != 2 {
		t.Errorf("OccurrenceCount = %d, want 2", st.OccurrenceCount)
	}
}

func TestOccurrenceCount_NoIncrementOnSuppressedExpired(t *testing.T) {
	s := newTestStore(t)

	s.UpsertFingerprint("fp1", "TestAlert", "homelab", nil) //nolint:errcheck

	// Silence cycle: firing → suppressed → expired → firing (same episode).
	s.RecordStatusChange("fp1", "homelab", "http://am:9093", models.EventStatusFiring, time.Now(), nil)     //nolint:errcheck
	s.RecordStatusChange("fp1", "homelab", "http://am:9093", models.EventStatusSuppressed, time.Now(), nil) //nolint:errcheck
	s.RecordStatusChange("fp1", "homelab", "http://am:9093", models.EventStatusExpired, time.Now(), nil)    //nolint:errcheck
	s.RecordStatusChange("fp1", "homelab", "http://am:9093", models.EventStatusFiring, time.Now(), nil)     //nolint:errcheck

	st, _ := s.GetStats("fp1")
	if st == nil {
		t.Fatal("stats nil")
	}
	// No full resolution occurred → occurrence_count stays at 1.
	if st.OccurrenceCount != 1 {
		t.Errorf("OccurrenceCount = %d, want 1 (no resolution between firings)", st.OccurrenceCount)
	}
}

func TestRecordResolved(t *testing.T) {
	s := newTestStore(t)

	s.UpsertFingerprint("fp1", "A", "c", nil) //nolint:errcheck
	s.UpsertFingerprint("fp2", "B", "c", nil) //nolint:errcheck

	s.RecordStatusChange("fp1", "c", "u", models.EventStatusFiring, time.Now(), nil) //nolint:errcheck
	s.RecordStatusChange("fp2", "c", "u", models.EventStatusFiring, time.Now(), nil) //nolint:errcheck

	if err := s.RecordResolved("fp1", time.Now()); err != nil {
		t.Fatalf("RecordResolved fp1: %v", err)
	}
	if err := s.RecordResolved("fp2", time.Now()); err != nil {
		t.Fatalf("RecordResolved fp2: %v", err)
	}

	events1, _, _ := s.GetHistory("fp1", 10, 0)
	if len(events1) == 0 || events1[0].Status != models.EventStatusResolved {
		t.Errorf("fp1 not resolved: %+v", events1)
	}
	events2, _, _ := s.GetHistory("fp2", 10, 0)
	if len(events2) == 0 || events2[0].Status != models.EventStatusResolved {
		t.Errorf("fp2 not resolved: %+v", events2)
	}
}

func TestRecordResolved_Idempotent(t *testing.T) {
	s := newTestStore(t)

	s.UpsertFingerprint("fp1", "A", "c", nil)                                        //nolint:errcheck
	s.RecordStatusChange("fp1", "c", "u", models.EventStatusFiring, time.Now(), nil) //nolint:errcheck
	s.RecordResolved("fp1", time.Now())                                              //nolint:errcheck

	// Second resolve call — must be a no-op.
	if err := s.RecordResolved("fp1", time.Now()); err != nil {
		t.Fatalf("second RecordResolved: %v", err)
	}

	_, total, _ := s.GetHistory("fp1", 10, 0)
	if total != 2 {
		t.Errorf("expected 2 rows (firing + resolved), got %d", total)
	}
}

func TestComments(t *testing.T) {
	s := newTestStore(t)

	s.UpsertFingerprint("fp1", "A", "c", nil) //nolint:errcheck

	c, err := s.AddComment("fp1", nil, "alice", "hello")
	if err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	if c.ID == 0 {
		t.Error("expected non-zero comment ID")
	}

	comments, err := s.GetComments("fp1")
	if err != nil {
		t.Fatalf("GetComments: %v", err)
	}
	if len(comments) != 1 || comments[0].Body != "hello" {
		t.Errorf("unexpected comments: %+v", comments)
	}

	deleted, err := s.DeleteComment(c.ID, "fp1")
	if err != nil || !deleted {
		t.Fatalf("DeleteComment: deleted=%v err=%v", deleted, err)
	}

	comments2, _ := s.GetComments("fp1")
	if len(comments2) != 0 {
		t.Errorf("expected 0 comments after delete, got %d", len(comments2))
	}
}

func TestDeleteComment_WrongFingerprint(t *testing.T) {
	s := newTestStore(t)

	s.UpsertFingerprint("fp1", "A", "c", nil) //nolint:errcheck
	s.UpsertFingerprint("fp2", "B", "c", nil) //nolint:errcheck

	c, err := s.AddComment("fp1", nil, "alice", "hello")
	if err != nil {
		t.Fatalf("AddComment: %v", err)
	}

	// Attempt to delete fp1's comment while scoped to fp2 — must not delete.
	deleted, err := s.DeleteComment(c.ID, "fp2")
	if err != nil {
		t.Fatalf("DeleteComment unexpected error: %v", err)
	}
	if deleted {
		t.Error("expected false: comment belongs to fp1, not fp2")
	}

	// Original comment must still exist.
	comments, _ := s.GetComments("fp1")
	if len(comments) != 1 {
		t.Errorf("expected comment to survive wrong-fingerprint delete, got %d comments", len(comments))
	}
}

func TestClaims(t *testing.T) {
	s := newTestStore(t)

	s.UpsertFingerprint("fp1", "A", "c", nil) //nolint:errcheck

	// No active claim initially.
	claim, err := s.GetActiveClaim("fp1")
	if err != nil || claim != nil {
		t.Fatalf("expected nil claim, got %+v err=%v", claim, err)
	}

	// Set a claim.
	c, err := s.SetClaim("fp1", nil, "alice", "looking into it")
	if err != nil {
		t.Fatalf("SetClaim: %v", err)
	}
	if c.ClaimedBy != "alice" {
		t.Errorf("ClaimedBy = %q", c.ClaimedBy)
	}

	active, _ := s.GetActiveClaim("fp1")
	if active == nil || active.ClaimedBy != "alice" {
		t.Fatalf("expected active claim by alice, got %+v", active)
	}

	// Release claim.
	released, err := s.ReleaseClaim("fp1", "alice", models.ReleaseReasonManual)
	if err != nil || !released {
		t.Fatalf("ReleaseClaim: released=%v err=%v", released, err)
	}

	active2, _ := s.GetActiveClaim("fp1")
	if active2 != nil {
		t.Errorf("expected nil after release, got %+v", active2)
	}
}

func TestReleaseClaimsForResolved(t *testing.T) {
	s := newTestStore(t)

	s.UpsertFingerprint("fp1", "A", "c", nil) //nolint:errcheck
	s.UpsertFingerprint("fp2", "B", "c", nil) //nolint:errcheck
	s.SetClaim("fp1", nil, "alice", "")       //nolint:errcheck
	s.SetClaim("fp2", nil, "bob", "")         //nolint:errcheck

	if err := s.ReleaseClaimsForResolved([]string{"fp1", "fp2"}); err != nil {
		t.Fatalf("ReleaseClaimsForResolved: %v", err)
	}

	c1, _ := s.GetActiveClaim("fp1")
	c2, _ := s.GetActiveClaim("fp2")
	if c1 != nil || c2 != nil {
		t.Error("expected all claims released")
	}
}
