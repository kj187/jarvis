package history

import (
	"context"
	"errors"
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

	c, err := s.AddComment("fp1", nil, nil, "alice", "hello")
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

	c, err := s.AddComment("fp1", nil, nil, "alice", "hello")
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
	claim, err := s.GetActiveClaim("fp1", "c")
	if err != nil || claim != nil {
		t.Fatalf("expected nil claim, got %+v err=%v", claim, err)
	}

	// Set a claim.
	c, err := s.SetClaim("fp1", "c", nil, "alice", "looking into it")
	if err != nil {
		t.Fatalf("SetClaim: %v", err)
	}
	if c.ClaimedBy != "alice" {
		t.Errorf("ClaimedBy = %q", c.ClaimedBy)
	}

	active, _ := s.GetActiveClaim("fp1", "c")
	if active == nil || active.ClaimedBy != "alice" {
		t.Fatalf("expected active claim by alice, got %+v", active)
	}

	// Release claim.
	released, err := s.ReleaseClaim("fp1", "c", "alice", models.ReleaseReasonManual)
	if err != nil || !released {
		t.Fatalf("ReleaseClaim: released=%v err=%v", released, err)
	}

	active2, _ := s.GetActiveClaim("fp1", "c")
	if active2 != nil {
		t.Errorf("expected nil after release, got %+v", active2)
	}
}

func TestUpdateClaimNote(t *testing.T) {
	s := newTestStore(t)
	s.UpsertFingerprint("fp1", "A", "c", nil) //nolint:errcheck

	// No active claim → ErrNoActiveClaim.
	if _, err := s.UpdateClaimNote("fp1", "c", "alice", "new"); !errors.Is(err, ErrNoActiveClaim) {
		t.Fatalf("expected ErrNoActiveClaim, got %v", err)
	}

	orig, err := s.SetClaim("fp1", "c", nil, "alice", "first note")
	if err != nil {
		t.Fatalf("SetClaim: %v", err)
	}

	// Non-owner cannot update.
	if _, err := s.UpdateClaimNote("fp1", "c", "bob", "hijack"); !errors.Is(err, ErrNotClaimOwner) {
		t.Fatalf("expected ErrNotClaimOwner, got %v", err)
	}

	// Owner updates note → new active claim, same owner, new note.
	updated, err := s.UpdateClaimNote("fp1", "c", "alice", "second note")
	if err != nil {
		t.Fatalf("UpdateClaimNote: %v", err)
	}
	if updated.ClaimedBy != "alice" || updated.Note != "second note" {
		t.Errorf("updated = %+v", updated)
	}
	if updated.ID == orig.ID {
		t.Errorf("expected a new immutable claim row, got same id %d", updated.ID)
	}

	// Active claim now reflects the new note.
	active, _ := s.GetActiveClaim("fp1", "c")
	if active == nil || active.Note != "second note" || active.ClaimedBy != "alice" {
		t.Fatalf("active = %+v", active)
	}

	// History is append-only: old row preserved, released with note_updated reason.
	hist, err := s.GetClaimHistory("fp1", "c")
	if err != nil {
		t.Fatalf("GetClaimHistory: %v", err)
	}
	if len(hist) != 2 {
		t.Fatalf("expected 2 immutable claim rows, got %d", len(hist))
	}
	var foundOldNote, foundNoteUpdated bool
	for _, h := range hist {
		if h.ID == orig.ID {
			if h.Note != "first note" {
				t.Errorf("old note mutated: %q", h.Note)
			}
			if h.ReleaseReason != models.ReleaseReasonNoteUpdated {
				t.Errorf("old release reason = %q", h.ReleaseReason)
			}
			if h.ReleasedBy != "alice" {
				t.Errorf("old released_by = %q", h.ReleasedBy)
			}
			foundOldNote = true
		}
		if h.ReleaseReason == models.ReleaseReasonNoteUpdated {
			foundNoteUpdated = true
		}
	}
	if !foundOldNote || !foundNoteUpdated {
		t.Errorf("history missing immutable note-update entry: %+v", hist)
	}
}

func TestReleaseClaimsForResolved(t *testing.T) {
	s := newTestStore(t)

	s.UpsertFingerprint("fp1", "A", "c", nil) //nolint:errcheck
	s.UpsertFingerprint("fp2", "B", "c", nil) //nolint:errcheck
	s.SetClaim("fp1", "c", nil, "alice", "")  //nolint:errcheck
	s.SetClaim("fp2", "c", nil, "bob", "")    //nolint:errcheck

	if err := s.ReleaseClaimsForResolved([]string{"fp1", "fp2"}); err != nil {
		t.Fatalf("ReleaseClaimsForResolved: %v", err)
	}

	c1, _ := s.GetActiveClaim("fp1", "c")
	c2, _ := s.GetActiveClaim("fp2", "c")
	if c1 != nil || c2 != nil {
		t.Error("expected all claims released")
	}
}

func TestGetTimeline_PaginatedAndSorted(t *testing.T) {
	s := newTestStore(t)

	fingerprint := "aabbccddeeff0011"
	cluster := "homelab"
	now := time.Now().UTC()

	s.UpsertFingerprint(fingerprint, "A", cluster, nil) //nolint:errcheck
	if _, err := s.exec(context.Background(),
		`INSERT INTO alert_events (fingerprint, cluster_name, alertmanager_url, status, starts_at, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`,
		fingerprint, cluster, "http://am:9093", models.EventStatusFiring, now.Add(-15*time.Minute), now.Add(-15*time.Minute),
	); err != nil {
		t.Fatalf("insert alert event: %v", err)
	}
	if _, err := s.exec(context.Background(),
		`INSERT INTO alert_claims (fingerprint, cluster_name, claimed_by, claimed_at, note) VALUES (?, ?, ?, ?, ?)`,
		fingerprint, cluster, "alice", now.Add(-10*time.Minute), "investigating",
	); err != nil {
		t.Fatalf("insert claim: %v", err)
	}
	if _, err := s.exec(context.Background(),
		`INSERT INTO silence_events (fingerprint, silence_id, cluster_name, action, performed_by, comment, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		fingerprint, "sil-1", cluster, "created", "bob", "maintenance", now.Add(-5*time.Minute),
	); err != nil {
		t.Fatalf("insert silence event: %v", err)
	}

	entries, total, err := s.GetTimeline(fingerprint, cluster, 2, 0)
	if err != nil {
		t.Fatalf("GetTimeline page 1: %v", err)
	}
	if total != 3 {
		t.Fatalf("total = %d, want 3", total)
	}
	if len(entries) != 2 {
		t.Fatalf("len(entries) = %d, want 2", len(entries))
	}
	if entries[0].Source != "silence" || entries[0].Action != "created" {
		t.Errorf("entries[0] = %+v, want newest silence created", entries[0])
	}
	if entries[1].Source != "claim" || entries[1].Action != "claimed" {
		t.Errorf("entries[1] = %+v, want claim row", entries[1])
	}

	entries2, _, err := s.GetTimeline(fingerprint, cluster, 2, 2)
	if err != nil {
		t.Fatalf("GetTimeline page 2: %v", err)
	}
	if len(entries2) != 1 {
		t.Fatalf("len(entries2) = %d, want 1", len(entries2))
	}
	if entries2[0].Source != "alert" || entries2[0].Action != models.EventStatusFiring {
		t.Errorf("entries2[0] = %+v, want alert firing row", entries2[0])
	}
}

func TestCreateSilenceTemplate(t *testing.T) {
	s := newTestStore(t)

	matchers := []models.SilenceMatcher{
		{Name: "alertname", Value: "HighMemory", IsEqual: true, IsRegex: false},
		{Name: "severity", Value: "critical", IsEqual: true, IsRegex: false},
	}
	template, err := s.CreateSilenceTemplate("tpl1", "Prod Maintenance", matchers, "Scheduled maintenance window")
	if err != nil {
		t.Fatalf("CreateSilenceTemplate: %v", err)
	}
	if template.ID != "tpl1" || template.Name != "Prod Maintenance" {
		t.Errorf("unexpected template: %+v", template)
	}
	if len(template.Matchers) != 2 {
		t.Errorf("expected 2 matchers, got %d", len(template.Matchers))
	}
}

func TestGetAllSilenceTemplates(t *testing.T) {
	s := newTestStore(t)

	matchers1 := []models.SilenceMatcher{
		{Name: "alertname", Value: "HighMemory", IsEqual: true, IsRegex: false},
	}
	matchers2 := []models.SilenceMatcher{
		{Name: "alertname", Value: "HighCPU", IsEqual: true, IsRegex: false},
	}

	s.CreateSilenceTemplate("tpl1", "Template 1", matchers1, "First template")  //nolint:errcheck
	s.CreateSilenceTemplate("tpl2", "Template 2", matchers2, "Second template") //nolint:errcheck

	templates, err := s.GetAllSilenceTemplates()
	if err != nil {
		t.Fatalf("GetAllSilenceTemplates: %v", err)
	}
	if len(templates) != 2 {
		t.Errorf("expected 2 templates, got %d", len(templates))
	}
}

func TestDeleteSilenceTemplate(t *testing.T) {
	s := newTestStore(t)

	matchers := []models.SilenceMatcher{
		{Name: "alertname", Value: "Test", IsEqual: true, IsRegex: false},
	}
	s.CreateSilenceTemplate("tpl1", "Template to Delete", matchers, "Delete me") //nolint:errcheck

	if err := s.DeleteSilenceTemplate("tpl1"); err != nil {
		t.Fatalf("DeleteSilenceTemplate: %v", err)
	}

	templates, _ := s.GetAllSilenceTemplates()
	if len(templates) != 0 {
		t.Errorf("expected 0 templates after delete, got %d", len(templates))
	}
}

func TestUpdateSilenceTemplate(t *testing.T) {
	s := newTestStore(t)

	matchers := []models.SilenceMatcher{
		{Name: "alertname", Value: "OldValue", IsEqual: true, IsRegex: false},
	}
	s.CreateSilenceTemplate("tpl1", "Original", matchers, "Original reason") //nolint:errcheck

	newMatchers := []models.SilenceMatcher{
		{Name: "alertname", Value: "NewValue", IsEqual: true, IsRegex: false},
	}
	updated, err := s.UpdateSilenceTemplate("tpl1", "Updated", newMatchers, "Updated reason")
	if err != nil {
		t.Fatalf("UpdateSilenceTemplate: %v", err)
	}
	if updated.Name != "Updated" || len(updated.Matchers) != 1 {
		t.Errorf("unexpected updated template: %+v", updated)
	}
	if updated.Matchers[0].Value != "NewValue" {
		t.Errorf("expected NewValue, got %s", updated.Matchers[0].Value)
	}
}
