package history

import (
	"context"
	"testing"

	"github.com/kj187/jarvis/backend/internal/models"
)

// TestGetActiveClaims verifies the batched claim query returns one entry per
// fingerprint with an active (unreleased) claim, picks the most recent claim per
// fingerprint, excludes released claims, and matches GetActiveClaim row-for-row.
func TestGetActiveClaims(t *testing.T) {
	s := newTestStore(t)

	labels := map[string]string{"alertname": "TestAlert"}
	for _, fp := range []string{"fp1", "fp2", "fp3"} {
		if err := s.UpsertFingerprint(fp, "TestAlert", "homelab", labels); err != nil {
			t.Fatalf("UpsertFingerprint %s: %v", fp, err)
		}
	}

	if _, err := s.SetClaim("fp1", "homelab", nil, "alice", "a"); err != nil {
		t.Fatalf("SetClaim fp1: %v", err)
	}
	if _, err := s.SetClaim("fp2", "homelab", nil, "bob", "b"); err != nil {
		t.Fatalf("SetClaim fp2: %v", err)
	}
	if _, err := s.SetClaim("fp3", "homelab", nil, "carol", "c"); err != nil {
		t.Fatalf("SetClaim fp3: %v", err)
	}
	// Release fp3's claim — it must not appear in the active set.
	if err := s.ReleaseClaimsForResolved([]string{"fp3"}); err != nil {
		t.Fatalf("ReleaseClaimsForResolved: %v", err)
	}
	// Re-claim fp1 — the newer claim must win over the older (now reclaimed) one.
	if _, err := s.SetClaim("fp1", "homelab", nil, "dave", "d"); err != nil {
		t.Fatalf("re-claim fp1: %v", err)
	}

	claims, err := s.GetActiveClaims()
	if err != nil {
		t.Fatalf("GetActiveClaims: %v", err)
	}

	if len(claims) != 2 {
		t.Fatalf("active claims = %d, want 2 (%v)", len(claims), claims)
	}
	fp1Key := ClaimKey{Fingerprint: "fp1", ClusterName: "homelab"}
	fp2Key := ClaimKey{Fingerprint: "fp2", ClusterName: "homelab"}
	fp3Key := ClaimKey{Fingerprint: "fp3", ClusterName: "homelab"}
	if claims[fp1Key] == nil || claims[fp1Key].ClaimedBy != "dave" {
		t.Errorf("fp1 claim = %+v, want most recent claim by dave", claims[fp1Key])
	}
	if claims[fp2Key] == nil || claims[fp2Key].ClaimedBy != "bob" {
		t.Errorf("fp2 claim = %+v, want claim by bob", claims[fp2Key])
	}
	if _, ok := claims[fp3Key]; ok {
		t.Errorf("fp3 has a released claim and must be excluded")
	}

	// Parity: the batched result must match GetActiveClaim for each key.
	for key, batched := range claims {
		single, err := s.GetActiveClaim(key.Fingerprint, key.ClusterName)
		if err != nil {
			t.Fatalf("GetActiveClaim(%v): %v", key, err)
		}
		if single == nil || single.ID != batched.ID {
			t.Errorf("key %v: batched claim ID %d mismatches GetActiveClaim", key, batched.ID)
		}
	}
}

// TestRecorder_AttachesActiveClaimBatched verifies that the poll loop attaches
// active claims to alerts through the batched query path.
func TestRecorder_AttachesActiveClaimBatched(t *testing.T) {
	rec, _ := newTestRecorder(t)
	ctx := context.Background()

	rec.processAlerts(ctx, alert("fp1", "active"))
	if _, err := rec.store.SetClaim("fp1", "homelab", nil, "alice", "mine"); err != nil {
		t.Fatalf("SetClaim: %v", err)
	}

	// Next poll must attach the claim via GetActiveClaims.
	rec.processAlerts(ctx, alert("fp1", "active"))

	var got *models.Claim
	for _, a := range rec.alertStore.Get() {
		if a.Fingerprint == "fp1" {
			got = a.ActiveClaim
		}
	}
	if got == nil {
		t.Fatal("expected active claim attached to fp1, got nil")
	}
	if got.ClaimedBy != "alice" {
		t.Errorf("ClaimedBy = %q, want alice", got.ClaimedBy)
	}
}

// TestRecorder_SkipsRedundantBroadcast verifies that an unchanged snapshot does
// not trigger a second WebSocket broadcast, while a changed snapshot does.
func TestRecorder_SkipsRedundantBroadcast(t *testing.T) {
	rec, hub := newTestRecorder(t)
	ctx := context.Background()

	// Build the alert once so two consecutive polls are byte-identical
	// (makeEnrichedAlert stamps StartsAt with time.Now on each call).
	same := []models.EnrichedAlert{makeEnrichedAlert("fp1", "active", "homelab")}

	rec.processAlerts(ctx, same)
	if len(hub.events) != 1 {
		t.Fatalf("after first poll: broadcasts = %d, want 1", len(hub.events))
	}

	// Identical snapshot → broadcast must be suppressed.
	rec.processAlerts(ctx, same)
	if len(hub.events) != 1 {
		t.Errorf("after identical poll: broadcasts = %d, want 1 (redundant broadcast not skipped)", len(hub.events))
	}

	// Changed snapshot (state differs) → broadcast must fire again.
	rec.processAlerts(ctx, []models.EnrichedAlert{makeEnrichedAlert("fp1", "suppressed", "homelab")})
	if len(hub.events) != 2 {
		t.Errorf("after changed poll: broadcasts = %d, want 2", len(hub.events))
	}
}
