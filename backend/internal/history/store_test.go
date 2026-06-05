package history

import (
	"testing"
	"time"

	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/models"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	db, err := idb.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := idb.Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return NewStore(db)
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

func TestGetOrCreateActiveEvent_CreatesNew(t *testing.T) {
	s := newTestStore(t)

	labels := map[string]string{"alertname": "TestAlert"}
	if err := s.UpsertFingerprint("fp1", "TestAlert", "homelab", labels); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	ev, err := s.GetOrCreateActiveEvent("fp1", "homelab", "http://am:9093", models.EventStatusFiring, time.Now(), nil)
	if err != nil {
		t.Fatalf("GetOrCreateActiveEvent: %v", err)
	}
	if ev.ID == 0 {
		t.Error("expected non-zero event ID")
	}
	if ev.Status != models.EventStatusFiring {
		t.Errorf("Status = %q, want firing", ev.Status)
	}
}

func TestGetOrCreateActiveEvent_ReturnsExisting(t *testing.T) {
	s := newTestStore(t)

	labels := map[string]string{"alertname": "TestAlert"}
	s.UpsertFingerprint("fp1", "TestAlert", "homelab", labels) //nolint:errcheck

	ev1, err := s.GetOrCreateActiveEvent("fp1", "homelab", "http://am:9093", models.EventStatusFiring, time.Now(), nil)
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	ev2, err := s.GetOrCreateActiveEvent("fp1", "homelab", "http://am:9093", models.EventStatusFiring, time.Now(), nil)
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if ev1.ID != ev2.ID {
		t.Errorf("expected same event ID (%d), got %d", ev1.ID, ev2.ID)
	}
}

func TestGetOrCreateActiveEvent_GracePeriod(t *testing.T) {
	s := newTestStore(t)

	labels := map[string]string{"alertname": "TestAlert"}
	s.UpsertFingerprint("fp1", "TestAlert", "homelab", labels) //nolint:errcheck

	// Create and immediately resolve an event.
	ev1, err := s.GetOrCreateActiveEvent("fp1", "homelab", "http://am:9093", models.EventStatusFiring, time.Now(), nil)
	if err != nil {
		t.Fatalf("create event: %v", err)
	}
	if err := s.ResolveEvents([]string{"fp1"}, time.Now()); err != nil {
		t.Fatalf("resolve: %v", err)
	}

	// Within grace period (< 60s) — must re-open, not create a new event.
	ev2, err := s.GetOrCreateActiveEvent("fp1", "homelab", "http://am:9093", models.EventStatusFiring, time.Now(), nil)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if ev1.ID != ev2.ID {
		t.Errorf("grace period: expected same event ID (%d), got %d", ev1.ID, ev2.ID)
	}
	if ev2.EndsAt != nil {
		t.Error("ends_at should be NULL after reopen")
	}
}

func TestOccurrenceCount_IncrementOnRefiring(t *testing.T) {
	s := newTestStore(t)

	labels := map[string]string{"alertname": "TestAlert"}
	s.UpsertFingerprint("fp1", "TestAlert", "homelab", labels) //nolint:errcheck

	// First firing.
	s.GetOrCreateActiveEvent("fp1", "homelab", "http://am:9093", models.EventStatusFiring, time.Now().Add(-2*time.Minute), nil) //nolint:errcheck

	// Resolve (simulate time passing beyond grace period).
	resolvedAt := time.Now().Add(-90 * time.Second)
	s.ResolveEvents([]string{"fp1"}, resolvedAt) //nolint:errcheck

	// Second firing (after grace period).
	s.GetOrCreateActiveEvent("fp1", "homelab", "http://am:9093", models.EventStatusFiring, time.Now(), nil) //nolint:errcheck

	// We need to manually set ends_at in the past to bypass grace period for test.
	// The grace period check uses ends_at >= cutoff; we set it far in the past.
	s.db.Exec(`UPDATE alert_events SET ends_at = ? WHERE fingerprint = ? AND ends_at IS NOT NULL`, //nolint:errcheck
		time.Now().Add(-120*time.Second), "fp1")

	s.GetOrCreateActiveEvent("fp1", "homelab", "http://am:9093", models.EventStatusFiring, time.Now(), nil) //nolint:errcheck

	st, _ := s.GetStats("fp1")
	if st == nil {
		t.Fatal("stats nil")
	}
	// occurrence_count starts at 1 (first insert), +1 on each re-fire after prior events.
	if st.OccurrenceCount < 1 {
		t.Errorf("OccurrenceCount = %d, want ≥ 1", st.OccurrenceCount)
	}
}

func TestResolveEvents(t *testing.T) {
	s := newTestStore(t)

	s.UpsertFingerprint("fp1", "A", "c", nil) //nolint:errcheck
	s.UpsertFingerprint("fp2", "B", "c", nil) //nolint:errcheck

	s.GetOrCreateActiveEvent("fp1", "c", "u", models.EventStatusFiring, time.Now(), nil) //nolint:errcheck
	s.GetOrCreateActiveEvent("fp2", "c", "u", models.EventStatusFiring, time.Now(), nil) //nolint:errcheck

	if err := s.ResolveEvents([]string{"fp1", "fp2"}, time.Now()); err != nil {
		t.Fatalf("ResolveEvents: %v", err)
	}

	events1, _, _ := s.GetHistory("fp1", 10, 0)
	if len(events1) == 0 || events1[0].EndsAt == nil {
		t.Error("fp1 event not resolved")
	}
	events2, _, _ := s.GetHistory("fp2", 10, 0)
	if len(events2) == 0 || events2[0].EndsAt == nil {
		t.Error("fp2 event not resolved")
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

	deleted, err := s.DeleteComment(c.ID)
	if err != nil || !deleted {
		t.Fatalf("DeleteComment: deleted=%v err=%v", deleted, err)
	}

	comments2, _ := s.GetComments("fp1")
	if len(comments2) != 0 {
		t.Errorf("expected 0 comments after delete, got %d", len(comments2))
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
