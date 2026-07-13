package history

import (
	"context"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/models"
)

// backdateEvent sets an alert_events row's recorded_at directly, bypassing
// RecordStatusChange's grace-period/idempotency logic — needed to build
// scenarios with events older than the sweep cutoff.
func backdateEvent(t *testing.T, s *Store, id int64, recordedAt time.Time) {
	t.Helper()
	if _, err := s.exec(context.Background(),
		`UPDATE alert_events SET recorded_at = ? WHERE id = ?`, recordedAt.UTC(), id,
	); err != nil {
		t.Fatalf("backdate event %d: %v", id, err)
	}
}

func backdateComment(t *testing.T, s *Store, id int64, createdAt time.Time) {
	t.Helper()
	if _, err := s.exec(context.Background(),
		`UPDATE alert_comments SET created_at = ? WHERE id = ?`, createdAt.UTC(), id,
	); err != nil {
		t.Fatalf("backdate comment %d: %v", id, err)
	}
}

func backdateClaimReleased(t *testing.T, s *Store, id int64, releasedAt time.Time) {
	t.Helper()
	if _, err := s.exec(context.Background(),
		`UPDATE alert_claims SET released_at = ? WHERE id = ?`, releasedAt.UTC(), id,
	); err != nil {
		t.Fatalf("backdate claim %d: %v", id, err)
	}
}

func backdateSilenceEvent(t *testing.T, s *Store, id int64, recordedAt time.Time) {
	t.Helper()
	if _, err := s.exec(context.Background(),
		`UPDATE silence_events SET recorded_at = ? WHERE id = ?`, recordedAt.UTC(), id,
	); err != nil {
		t.Fatalf("backdate silence_event %d: %v", id, err)
	}
}

func backdateFingerprintLastSeen(t *testing.T, s *Store, fingerprint string, lastSeenAt time.Time) {
	t.Helper()
	if _, err := s.exec(context.Background(),
		`UPDATE alert_fingerprints SET last_seen_at = ? WHERE fingerprint = ?`, lastSeenAt.UTC(), fingerprint,
	); err != nil {
		t.Fatalf("backdate fingerprint %s: %v", fingerprint, err)
	}
}

func countRows(t *testing.T, s *Store, table string) int {
	t.Helper()
	var n int
	if err := s.queryRow(context.Background(), `SELECT COUNT(*) FROM `+table).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

const oldCutoffDays = 30

func oldCutoff() time.Time {
	return time.Now().UTC().AddDate(0, 0, -oldCutoffDays)
}

func TestDeleteSweepableEventsBefore_OpenFiringHeadSurvives(t *testing.T) {
	s := newTestStore(t)
	cutoff := oldCutoff()

	if err := s.UpsertFingerprint("fp1", "TestAlert", "cluster-a", map[string]string{"alertname": "TestAlert"}); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	ev, _, err := s.RecordStatusChange("fp1", "cluster-a", "http://am", models.EventStatusFiring, time.Now(), nil)
	if err != nil {
		t.Fatalf("RecordStatusChange: %v", err)
	}
	// Ancient firing row, but it's the only (= latest) event for this fingerprint+cluster.
	backdateEvent(t, s, ev.ID, time.Now().AddDate(-1, 0, 0))

	n, err := s.DeleteSweepableEventsBefore(context.Background(), cutoff, 500)
	if err != nil {
		t.Fatalf("DeleteSweepableEventsBefore: %v", err)
	}
	if n != 0 {
		t.Errorf("deleted = %d, want 0 (open firing head must survive)", n)
	}
	if got := countRows(t, s, "alert_events"); got != 1 {
		t.Errorf("alert_events count = %d, want 1", got)
	}
}

func TestDeleteSweepableEventsBefore_OpenSuppressedHeadSurvives(t *testing.T) {
	s := newTestStore(t)
	cutoff := oldCutoff()

	if err := s.UpsertFingerprint("fp1", "TestAlert", "cluster-a", nil); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	ev, _, err := s.RecordStatusChange("fp1", "cluster-a", "http://am", models.EventStatusSuppressed, time.Now(), nil)
	if err != nil {
		t.Fatalf("RecordStatusChange: %v", err)
	}
	backdateEvent(t, s, ev.ID, time.Now().AddDate(-1, 0, 0))

	n, err := s.DeleteSweepableEventsBefore(context.Background(), cutoff, 500)
	if err != nil {
		t.Fatalf("DeleteSweepableEventsBefore: %v", err)
	}
	if n != 0 {
		t.Errorf("deleted = %d, want 0 (open suppressed head must survive)", n)
	}
}

func TestDeleteSweepableEventsBefore_SupersededFiringRowDeleted(t *testing.T) {
	s := newTestStore(t)
	cutoff := oldCutoff()

	if err := s.UpsertFingerprint("fp1", "TestAlert", "cluster-a", nil); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	firstFiring, _, err := s.RecordStatusChange("fp1", "cluster-a", "http://am", models.EventStatusFiring, time.Now(), nil)
	if err != nil {
		t.Fatalf("RecordStatusChange firing: %v", err)
	}
	backdateEvent(t, s, firstFiring.ID, time.Now().AddDate(0, 0, -60))

	if err := s.RecordResolvedForCluster("fp1", "cluster-a", time.Now()); err != nil {
		t.Fatalf("RecordResolvedForCluster: %v", err)
	}
	resolvedEvent, err := s.getLastEventForCluster("fp1", "cluster-a")
	if err != nil {
		t.Fatalf("getLastEventForCluster: %v", err)
	}
	// Both rows must be older than cutoff, with the resolved row unambiguously
	// newer than the firing row it supersedes (distinct offsets, not relying
	// on wall-clock ordering between two near-simultaneous backdate calls).
	backdateEvent(t, s, resolvedEvent.ID, time.Now().AddDate(0, 0, -45))

	n, err := s.DeleteSweepableEventsBefore(context.Background(), cutoff, 500)
	if err != nil {
		t.Fatalf("DeleteSweepableEventsBefore: %v", err)
	}
	if n != 2 {
		t.Errorf("deleted = %d, want 2 (superseded firing row + old resolved row)", n)
	}
	if got := countRows(t, s, "alert_events"); got != 0 {
		t.Errorf("alert_events count = %d, want 0", got)
	}
}

func TestDeleteSweepableEventsBefore_ResolvedNewerThanCutoffSurvives(t *testing.T) {
	s := newTestStore(t)
	cutoff := oldCutoff()

	if err := s.UpsertFingerprint("fp1", "TestAlert", "cluster-a", nil); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	if _, _, err := s.RecordStatusChange("fp1", "cluster-a", "http://am", models.EventStatusFiring, time.Now(), nil); err != nil {
		t.Fatalf("RecordStatusChange: %v", err)
	}
	if err := s.RecordResolvedForCluster("fp1", "cluster-a", time.Now()); err != nil {
		t.Fatalf("RecordResolvedForCluster: %v", err)
	}
	// Both rows are recent (recorded "now"), well within the cutoff window.

	n, err := s.DeleteSweepableEventsBefore(context.Background(), cutoff, 500)
	if err != nil {
		t.Fatalf("DeleteSweepableEventsBefore: %v", err)
	}
	if n != 0 {
		t.Errorf("deleted = %d, want 0 (recent resolved episode must survive)", n)
	}
}

func TestDeleteSweepableEventsBefore_Batching(t *testing.T) {
	s := newTestStore(t)
	cutoff := oldCutoff()

	if err := s.UpsertFingerprint("fp1", "TestAlert", "cluster-a", nil); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	// 1200 old resolved rows, all sweepable (all resolved status).
	const total = 1200
	for i := 0; i < total; i++ {
		id, err := s.insertReturningID(context.Background(), `
			INSERT INTO alert_events (fingerprint, cluster_name, alertmanager_url, status, starts_at, recorded_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`, "fp1", "cluster-a", "http://am", models.EventStatusResolved, time.Now(), time.Now())
		if err != nil {
			t.Fatalf("seed event %d: %v", i, err)
		}
		backdateEvent(t, s, id, time.Now().AddDate(0, 0, -60))
	}

	n, err := s.DeleteSweepableEventsBefore(context.Background(), cutoff, 500)
	if err != nil {
		t.Fatalf("DeleteSweepableEventsBefore: %v", err)
	}
	if n != total {
		t.Errorf("deleted = %d, want %d", n, total)
	}
	if got := countRows(t, s, "alert_events"); got != 0 {
		t.Errorf("alert_events count = %d, want 0", got)
	}
}

func TestDeleteSweepableEventsBefore_ContextCancelStops(t *testing.T) {
	s := newTestStore(t)

	if err := s.UpsertFingerprint("fp1", "TestAlert", "cluster-a", nil); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	for i := 0; i < 10; i++ {
		id, err := s.insertReturningID(context.Background(), `
			INSERT INTO alert_events (fingerprint, cluster_name, alertmanager_url, status, starts_at, recorded_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`, "fp1", "cluster-a", "http://am", models.EventStatusResolved, time.Now(), time.Now())
		if err != nil {
			t.Fatalf("seed event %d: %v", i, err)
		}
		backdateEvent(t, s, id, time.Now().AddDate(0, 0, -60))
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := s.DeleteSweepableEventsBefore(ctx, oldCutoff(), 500)
	if err == nil {
		t.Fatal("DeleteSweepableEventsBefore with a cancelled context: err = nil, want context.Canceled")
	}
}

func TestDetachCommentsAndClaimsFromSweepableEventsBefore(t *testing.T) {
	s := newTestStore(t)
	cutoff := oldCutoff()

	if err := s.UpsertFingerprint("fp1", "TestAlert", "cluster-a", nil); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	openHead, _, err := s.RecordStatusChange("fp1", "cluster-a", "http://am", models.EventStatusFiring, time.Now(), nil)
	if err != nil {
		t.Fatalf("RecordStatusChange: %v", err)
	}
	backdateEvent(t, s, openHead.ID, time.Now().AddDate(-1, 0, 0))

	if err := s.RecordResolvedForCluster("fp1", "cluster-a", time.Now()); err != nil {
		t.Fatalf("RecordResolvedForCluster: %v", err)
	}
	// Now firing (openHead.ID) is superseded → sweepable; the new resolved row is the head.
	// Add a second, older fingerprint whose sole event stays open (firing head) to attach a comment/claim to.
	if err := s.UpsertFingerprint("fp2", "TestAlert", "cluster-a", nil); err != nil {
		t.Fatalf("UpsertFingerprint fp2: %v", err)
	}
	survivingHead, _, err := s.RecordStatusChange("fp2", "cluster-a", "http://am", models.EventStatusFiring, time.Now(), nil)
	if err != nil {
		t.Fatalf("RecordStatusChange fp2: %v", err)
	}
	backdateEvent(t, s, survivingHead.ID, time.Now().AddDate(-1, 0, 0))

	sweepableComment, err := s.AddComment("fp1", "cluster-a", &openHead.ID, nil, "alice", "old comment")
	if err != nil {
		t.Fatalf("AddComment sweepable: %v", err)
	}
	survivingComment, err := s.AddComment("fp2", "cluster-a", &survivingHead.ID, nil, "bob", "still-open comment")
	if err != nil {
		t.Fatalf("AddComment surviving: %v", err)
	}

	sweepableClaim, err := s.SetClaim("fp1", "cluster-a", &openHead.ID, "alice", "")
	if err != nil {
		t.Fatalf("SetClaim sweepable: %v", err)
	}
	if _, err := s.ReleaseClaim("fp1", "cluster-a", "alice", "manual"); err != nil {
		t.Fatalf("ReleaseClaim: %v", err)
	}
	survivingClaim, err := s.SetClaim("fp2", "cluster-a", &survivingHead.ID, "bob", "")
	if err != nil {
		t.Fatalf("SetClaim surviving: %v", err)
	}

	n, err := s.DetachCommentsAndClaimsFromSweepableEventsBefore(context.Background(), cutoff)
	if err != nil {
		t.Fatalf("DetachCommentsAndClaimsFromSweepableEventsBefore: %v", err)
	}
	if n != 2 {
		t.Errorf("detached = %d, want 2 (1 comment + 1 claim)", n)
	}

	gotComment, err := s.GetComment("fp1", "cluster-a", sweepableComment.ID)
	if err != nil {
		t.Fatalf("GetComment sweepable: %v", err)
	}
	if gotComment.EventID != nil {
		t.Errorf("sweepable comment EventID = %v, want nil", gotComment.EventID)
	}

	gotSurvivingComment, err := s.GetComment("fp2", "cluster-a", survivingComment.ID)
	if err != nil {
		t.Fatalf("GetComment surviving: %v", err)
	}
	if gotSurvivingComment.EventID == nil || *gotSurvivingComment.EventID != survivingHead.ID {
		t.Errorf("surviving comment EventID = %v, want %d", gotSurvivingComment.EventID, survivingHead.ID)
	}

	var claimEventID *int64
	if err := s.queryRow(context.Background(), `SELECT event_id FROM alert_claims WHERE id = ?`, sweepableClaim.ID).Scan(&claimEventID); err != nil {
		t.Fatalf("query sweepable claim event_id: %v", err)
	}
	if claimEventID != nil {
		t.Errorf("sweepable claim event_id = %v, want nil", claimEventID)
	}

	var survivingClaimEventID *int64
	if err := s.queryRow(context.Background(), `SELECT event_id FROM alert_claims WHERE id = ?`, survivingClaim.ID).Scan(&survivingClaimEventID); err != nil {
		t.Fatalf("query surviving claim event_id: %v", err)
	}
	if survivingClaimEventID == nil || *survivingClaimEventID != survivingHead.ID {
		t.Errorf("surviving claim event_id = %v, want %d", survivingClaimEventID, survivingHead.ID)
	}
}

func TestDeleteReleasedClaimsBefore(t *testing.T) {
	s := newTestStore(t)
	cutoff := oldCutoff()

	if err := s.UpsertFingerprint("fp1", "TestAlert", "cluster-a", nil); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}

	activeClaim, err := s.SetClaim("fp1", "cluster-a", nil, "alice", "")
	if err != nil {
		t.Fatalf("SetClaim active: %v", err)
	}

	oldReleasedClaim, err := s.SetClaim("fp1", "cluster-a", nil, "bob", "")
	if err != nil {
		t.Fatalf("SetClaim old-released: %v", err)
	}
	if _, err := s.ReleaseClaim("fp1", "cluster-a", "bob", "manual"); err != nil {
		t.Fatalf("ReleaseClaim old: %v", err)
	}
	backdateClaimReleased(t, s, oldReleasedClaim.ID, time.Now().AddDate(0, 0, -60))

	recentReleasedClaim, err := s.SetClaim("fp1", "cluster-a", nil, "carol", "")
	if err != nil {
		t.Fatalf("SetClaim recent-released: %v", err)
	}
	if _, err := s.ReleaseClaim("fp1", "cluster-a", "carol", "manual"); err != nil {
		t.Fatalf("ReleaseClaim recent: %v", err)
	}

	n, err := s.DeleteReleasedClaimsBefore(context.Background(), cutoff, 500)
	if err != nil {
		t.Fatalf("DeleteReleasedClaimsBefore: %v", err)
	}
	if n != 1 {
		t.Errorf("deleted = %d, want 1 (only the old released claim)", n)
	}

	var count int
	if err := s.queryRow(context.Background(), `SELECT COUNT(*) FROM alert_claims WHERE id = ?`, oldReleasedClaim.ID).Scan(&count); err != nil {
		t.Fatalf("count old claim: %v", err)
	}
	if count != 0 {
		t.Error("old released claim still present, want deleted")
	}
	if err := s.queryRow(context.Background(), `SELECT COUNT(*) FROM alert_claims WHERE id = ?`, recentReleasedClaim.ID).Scan(&count); err != nil {
		t.Fatalf("count recent claim: %v", err)
	}
	if count != 1 {
		t.Error("recent released claim missing, want present")
	}
	if err := s.queryRow(context.Background(), `SELECT COUNT(*) FROM alert_claims WHERE id = ?`, activeClaim.ID).Scan(&count); err != nil {
		t.Fatalf("count active claim: %v", err)
	}
	if count != 1 {
		t.Error("active claim missing, want present regardless of age")
	}
}

func TestDeleteCommentsBefore(t *testing.T) {
	s := newTestStore(t)
	cutoff := oldCutoff()

	if err := s.UpsertFingerprint("fp1", "TestAlert", "cluster-a", nil); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}

	oldComment, err := s.AddComment("fp1", "cluster-a", nil, nil, "alice", "old")
	if err != nil {
		t.Fatalf("AddComment old: %v", err)
	}
	backdateComment(t, s, oldComment.ID, time.Now().AddDate(0, 0, -60))

	recentComment, err := s.AddComment("fp1", "cluster-a", nil, nil, "bob", "recent")
	if err != nil {
		t.Fatalf("AddComment recent: %v", err)
	}

	n, err := s.DeleteCommentsBefore(context.Background(), cutoff, 500)
	if err != nil {
		t.Fatalf("DeleteCommentsBefore: %v", err)
	}
	if n != 1 {
		t.Errorf("deleted = %d, want 1", n)
	}

	if got, err := s.GetComment("fp1", "cluster-a", oldComment.ID); err != nil {
		t.Errorf("GetComment old: %v", err)
	} else if got != nil {
		t.Error("old comment still retrievable, want deleted")
	}
	if got, err := s.GetComment("fp1", "cluster-a", recentComment.ID); err != nil {
		t.Errorf("recent comment not retrievable: %v", err)
	} else if got == nil {
		t.Error("recent comment missing, want present")
	}
}

func TestDeleteSilenceEventsBefore(t *testing.T) {
	s := newTestStore(t)
	cutoff := oldCutoff()

	oldEvent, err := s.RecordSilenceEvent("fp1", "sil-1", "cluster-a", "created", "alice", "")
	if err != nil {
		t.Fatalf("RecordSilenceEvent old: %v", err)
	}
	backdateSilenceEvent(t, s, oldEvent.ID, time.Now().AddDate(0, 0, -60))

	if _, err := s.RecordSilenceEvent("fp1", "sil-2", "cluster-a", "created", "bob", ""); err != nil {
		t.Fatalf("RecordSilenceEvent recent: %v", err)
	}

	n, err := s.DeleteSilenceEventsBefore(context.Background(), cutoff, 500)
	if err != nil {
		t.Fatalf("DeleteSilenceEventsBefore: %v", err)
	}
	if n != 1 {
		t.Errorf("deleted = %d, want 1", n)
	}
	if got := countRows(t, s, "silence_events"); got != 1 {
		t.Errorf("silence_events count = %d, want 1", got)
	}
}

func TestDeleteOrphanFingerprintsBefore_SurvivesWithComment(t *testing.T) {
	s := newTestStore(t)
	cutoff := oldCutoff()

	if err := s.UpsertFingerprint("fp1", "TestAlert", "cluster-a", nil); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	if _, err := s.AddComment("fp1", "cluster-a", nil, nil, "alice", "keep me"); err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	backdateFingerprintLastSeen(t, s, "fp1", time.Now().AddDate(0, 0, -60))

	n, err := s.DeleteOrphanFingerprintsBefore(context.Background(), cutoff, 500)
	if err != nil {
		t.Fatalf("DeleteOrphanFingerprintsBefore: %v", err)
	}
	if n != 0 {
		t.Errorf("deleted = %d, want 0 (fingerprint with a comment must survive)", n)
	}
}

func TestDeleteOrphanFingerprintsBefore_DeletesTrueOrphan(t *testing.T) {
	s := newTestStore(t)
	cutoff := oldCutoff()

	if err := s.UpsertFingerprint("fp1", "TestAlert", "cluster-a", nil); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	backdateFingerprintLastSeen(t, s, "fp1", time.Now().AddDate(0, 0, -60))

	n, err := s.DeleteOrphanFingerprintsBefore(context.Background(), cutoff, 500)
	if err != nil {
		t.Fatalf("DeleteOrphanFingerprintsBefore: %v", err)
	}
	if n != 1 {
		t.Errorf("deleted = %d, want 1 (fully orphaned old fingerprint)", n)
	}
}

func TestDeleteOrphanFingerprintsBefore_RecentlySeenSurvives(t *testing.T) {
	s := newTestStore(t)
	cutoff := oldCutoff()

	if err := s.UpsertFingerprint("fp1", "TestAlert", "cluster-a", nil); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	// last_seen_at defaults to "now" — well inside the cutoff window.

	n, err := s.DeleteOrphanFingerprintsBefore(context.Background(), cutoff, 500)
	if err != nil {
		t.Fatalf("DeleteOrphanFingerprintsBefore: %v", err)
	}
	if n != 0 {
		t.Errorf("deleted = %d, want 0 (recently seen fingerprint must survive)", n)
	}
}

func TestDeleteOrphanFingerprintsBefore_SurvivesWithOpenEvent(t *testing.T) {
	s := newTestStore(t)
	cutoff := oldCutoff()

	if err := s.UpsertFingerprint("fp1", "TestAlert", "cluster-a", nil); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	if _, _, err := s.RecordStatusChange("fp1", "cluster-a", "http://am", models.EventStatusFiring, time.Now(), nil); err != nil {
		t.Fatalf("RecordStatusChange: %v", err)
	}
	backdateFingerprintLastSeen(t, s, "fp1", time.Now().AddDate(0, 0, -60))

	n, err := s.DeleteOrphanFingerprintsBefore(context.Background(), cutoff, 500)
	if err != nil {
		t.Fatalf("DeleteOrphanFingerprintsBefore: %v", err)
	}
	if n != 0 {
		t.Errorf("deleted = %d, want 0 (fingerprint with an event must survive)", n)
	}
}

// TestRefireAfterFullEventSweep_NoOccurrenceInflation covers Critical design
// decision 7 of idea-3.13: if a fingerprint survives a sweep only because it
// still has comments (all its events were deleted), a later re-fire finds no
// previous event and is treated like a first firing — occurrence_count is
// NOT incremented (the upsert leaves the existing count untouched). This is
// the accepted trade-off: the count is preserved, never inflated.
func TestRefireAfterFullEventSweep_NoOccurrenceInflation(t *testing.T) {
	s := newTestStore(t)

	if err := s.UpsertFingerprint("fp1", "TestAlert", "cluster-a", nil); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	if _, err := s.AddComment("fp1", "cluster-a", nil, nil, "alice", "old context"); err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	firingEvent, _, err := s.RecordStatusChange("fp1", "cluster-a", "http://am", models.EventStatusFiring, time.Now(), nil)
	if err != nil {
		t.Fatalf("RecordStatusChange firing: %v", err)
	}
	if err := s.RecordResolvedForCluster("fp1", "cluster-a", time.Now()); err != nil {
		t.Fatalf("RecordResolvedForCluster: %v", err)
	}
	resolvedEvent, err := s.getLastEventForCluster("fp1", "cluster-a")
	if err != nil {
		t.Fatalf("getLastEventForCluster: %v", err)
	}

	statsBefore, err := s.GetStats("fp1")
	if err != nil {
		t.Fatalf("GetStats before sweep: %v", err)
	}

	// Simulate both events aging past the cutoff (distinct offsets, so the
	// resolved row is unambiguously newer than the firing row it supersedes)
	// and being swept, while the comment keeps the fingerprint alive.
	backdateEvent(t, s, firingEvent.ID, time.Now().AddDate(0, 0, -60))
	backdateEvent(t, s, resolvedEvent.ID, time.Now().AddDate(0, 0, -45))
	if _, err := s.DeleteSweepableEventsBefore(context.Background(), oldCutoff(), 500); err != nil {
		t.Fatalf("DeleteSweepableEventsBefore: %v", err)
	}
	if got := countRows(t, s, "alert_events"); got != 0 {
		t.Fatalf("alert_events count = %d, want 0 (setup precondition)", got)
	}

	// Re-fire: RecordStatusChange finds no previous event for this cluster.
	if _, _, err := s.RecordStatusChange("fp1", "cluster-a", "http://am", models.EventStatusFiring, time.Now(), nil); err != nil {
		t.Fatalf("RecordStatusChange refire: %v", err)
	}

	statsAfter, err := s.GetStats("fp1")
	if err != nil {
		t.Fatalf("GetStats after refire: %v", err)
	}
	if statsAfter.OccurrenceCount != statsBefore.OccurrenceCount {
		t.Errorf("OccurrenceCount after refire = %d, want unchanged %d (no inflation)", statsAfter.OccurrenceCount, statsBefore.OccurrenceCount)
	}
}
