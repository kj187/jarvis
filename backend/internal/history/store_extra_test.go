package history

import (
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/models"
)

// ── GetClaimHistory ───────────────────────────────────────────────────────────

func TestGetClaimHistory_Empty(t *testing.T) {
	rec, _ := newTestRecorder(t)
	claims, err := rec.store.GetClaimHistory("abc123")
	if err != nil {
		t.Fatalf("GetClaimHistory: %v", err)
	}
	if len(claims) != 0 {
		t.Errorf("expected 0 claims, got %d", len(claims))
	}
}

func TestGetClaimHistory_WithClaims(t *testing.T) {
	rec, _ := newTestRecorder(t)

	// Seed fingerprint first (FK constraint)
	if err := rec.store.UpsertFingerprint("fp1", "TestAlert", "homelab", map[string]string{}); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}

	// Create two claims
	c1, err := rec.store.SetClaim("fp1", nil, "alice", "first claim")
	if err != nil || c1 == nil {
		t.Fatalf("SetClaim 1: %v", err)
	}
	_, err = rec.store.ReleaseClaim("fp1", "alice", models.ReleaseReasonManual)
	if err != nil {
		t.Fatalf("ReleaseClaim: %v", err)
	}

	c2, err := rec.store.SetClaim("fp1", nil, "bob", "second claim")
	if err != nil || c2 == nil {
		t.Fatalf("SetClaim 2: %v", err)
	}

	claims, err := rec.store.GetClaimHistory("fp1")
	if err != nil {
		t.Fatalf("GetClaimHistory: %v", err)
	}
	if len(claims) != 2 {
		t.Fatalf("expected 2 claims, got %d", len(claims))
	}
	// newest first
	if claims[0].ClaimedBy != "bob" {
		t.Errorf("claims[0].ClaimedBy = %q, want bob", claims[0].ClaimedBy)
	}
	if claims[1].ClaimedBy != "alice" {
		t.Errorf("claims[1].ClaimedBy = %q, want alice", claims[1].ClaimedBy)
	}
	// alice's claim should be released
	if claims[1].ReleasedAt == nil {
		t.Error("claims[1].ReleasedAt should not be nil (claim was released)")
	}
}

// ── RecordSilenceEvent / GetSilenceEvents ─────────────────────────────────────

func TestRecordSilenceEvent_And_GetSilenceEvents(t *testing.T) {
	rec, _ := newTestRecorder(t)

	ev, err := rec.store.RecordSilenceEvent("fp1", "silence-1", "homelab", "created", "alice", "test silence")
	if err != nil {
		t.Fatalf("RecordSilenceEvent: %v", err)
	}
	if ev == nil {
		t.Fatal("expected event, got nil")
	}
	if ev.Action != "created" {
		t.Errorf("Action = %q, want created", ev.Action)
	}
	if ev.PerformedBy != "alice" {
		t.Errorf("PerformedBy = %q, want alice", ev.PerformedBy)
	}

	events, err := rec.store.GetSilenceEvents("fp1")
	if err != nil {
		t.Fatalf("GetSilenceEvents: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].SilenceID != "silence-1" {
		t.Errorf("SilenceID = %q, want silence-1", events[0].SilenceID)
	}
}

func TestGetSilenceEvents_Empty(t *testing.T) {
	rec, _ := newTestRecorder(t)
	events, err := rec.store.GetSilenceEvents("nonexistent")
	if err != nil {
		t.Fatalf("GetSilenceEvents: %v", err)
	}
	if len(events) != 0 {
		t.Errorf("expected 0 events, got %d", len(events))
	}
}

func TestGetSilenceEvents_MultipleFPs(t *testing.T) {
	rec, _ := newTestRecorder(t)

	if _, err := rec.store.RecordSilenceEvent("fp1", "s1", "homelab", "created", "alice", ""); err != nil {
		t.Fatalf("RecordSilenceEvent fp1: %v", err)
	}
	if _, err := rec.store.RecordSilenceEvent("fp2", "s2", "homelab", "deleted", "bob", ""); err != nil {
		t.Fatalf("RecordSilenceEvent fp2: %v", err)
	}

	events1, _ := rec.store.GetSilenceEvents("fp1")
	events2, _ := rec.store.GetSilenceEvents("fp2")

	if len(events1) != 1 {
		t.Errorf("fp1: expected 1 event, got %d", len(events1))
	}
	if len(events2) != 1 {
		t.Errorf("fp2: expected 1 event, got %d", len(events2))
	}
}

// ── GetRecentResolved ─────────────────────────────────────────────────────────

func TestGetRecentResolved_Empty(t *testing.T) {
	rec, _ := newTestRecorder(t)
	alerts, err := rec.store.GetRecentResolved(20 * time.Minute)
	if err != nil {
		t.Fatalf("GetRecentResolved: %v", err)
	}
	if len(alerts) != 0 {
		t.Errorf("expected 0 alerts, got %d", len(alerts))
	}
}

func TestGetRecentResolved_WithRecentResolved(t *testing.T) {
	rec, _ := newTestRecorder(t)

	// Create a firing then resolved alert
	if err := rec.store.UpsertFingerprint("fp1", "TestAlert", "homelab", map[string]string{"alertname": "TestAlert"}); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	_, err := rec.store.RecordStatusChange("fp1", "homelab", "http://am:9093", "firing", time.Now().UTC(), nil)
	if err != nil {
		t.Fatalf("RecordStatusChange: %v", err)
	}
	if err := rec.store.RecordResolved("fp1", time.Now().UTC()); err != nil {
		t.Fatalf("RecordResolved: %v", err)
	}

	alerts, err := rec.store.GetRecentResolved(20 * time.Minute)
	if err != nil {
		t.Fatalf("GetRecentResolved: %v", err)
	}
	if len(alerts) != 1 {
		t.Fatalf("expected 1 alert, got %d", len(alerts))
	}
	if alerts[0].Fingerprint != "fp1" {
		t.Errorf("Fingerprint = %q, want fp1", alerts[0].Fingerprint)
	}
	if alerts[0].Status.State != "resolved" {
		t.Errorf("State = %q, want resolved", alerts[0].Status.State)
	}
}

func TestGetRecentResolved_ExcludesOldResolved(t *testing.T) {
	rec, _ := newTestRecorder(t)

	if err := rec.store.UpsertFingerprint("fp1", "TestAlert", "homelab", map[string]string{"alertname": "TestAlert"}); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	_, err := rec.store.RecordStatusChange("fp1", "homelab", "http://am:9093", "firing", time.Now().UTC(), nil)
	if err != nil {
		t.Fatalf("RecordStatusChange: %v", err)
	}
	// Record resolved 30 minutes ago
	if err := rec.store.RecordResolved("fp1", time.Now().UTC().Add(-30*time.Minute)); err != nil {
		t.Fatalf("RecordResolved: %v", err)
	}

	// Query with 20-min window — alert resolved 30 min ago should NOT appear
	alerts, err := rec.store.GetRecentResolved(20 * time.Minute)
	if err != nil {
		t.Fatalf("GetRecentResolved: %v", err)
	}
	if len(alerts) != 0 {
		t.Errorf("expected 0 alerts (resolved too long ago), got %d", len(alerts))
	}
}

// ── SeedResolved (AlertStore) ─────────────────────────────────────────────────

func TestAlertStore_SeedResolved(t *testing.T) {
	s := &AlertStore{}
	s.SeedResolved([]models.EnrichedAlert{
		makeAlert("fp1", "resolved"),
		makeAlert("fp2", "resolved"),
	})

	got := s.Get()
	if len(got) != 2 {
		t.Fatalf("expected 2 seeded alerts, got %d", len(got))
	}
}

func TestAlertStore_SeedResolved_NoOverwrite(t *testing.T) {
	s := &AlertStore{}
	s.SeedResolved([]models.EnrichedAlert{makeAlert("fp1", "resolved")})
	// Seed again — should not overwrite
	s.SeedResolved([]models.EnrichedAlert{makeAlert("fp1", "active")})

	got := s.Get()
	if got[0].Status.State != "resolved" {
		t.Errorf("SeedResolved overwrote existing entry: state = %q", got[0].Status.State)
	}
}

func TestAlertStore_SeedResolved_ClearedBySet(t *testing.T) {
	s := &AlertStore{}
	s.SeedResolved([]models.EnrichedAlert{makeAlert("fp1", "resolved")})
	// Set with fp1 as active — should remove from resolved buffer
	s.Set([]models.EnrichedAlert{makeAlert("fp1", "active")})

	got := s.Get()
	if len(got) != 1 {
		t.Fatalf("expected 1 alert, got %d", len(got))
	}
	if got[0].Status.State != "active" {
		t.Errorf("state = %q, want active", got[0].Status.State)
	}
}
