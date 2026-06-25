package history

import (
	"context"
	"testing"

	"github.com/kj187/jarvis/backend/internal/models"
)

// TestClaim_ScopedByCluster reproduces the bug where claiming one alert in a
// group also claimed its twin in another cluster. The same alert mirrored across
// two Alertmanager clusters shares ONE fingerprint (cluster is not part of the
// AM fingerprint), so a claim keyed by fingerprint alone leaked across clusters.
// Claims must be scoped by (fingerprint, cluster).
func TestClaim_ScopedByCluster(t *testing.T) {
	s := newTestStore(t)

	// One fingerprint row is enough for the FK; cluster lives on the claim.
	if err := s.UpsertFingerprint("fp1", "KubePodCrashLooping", "homelab",
		map[string]string{"alertname": "KubePodCrashLooping"}); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}

	// Claim only the homelab alert.
	if _, err := s.SetClaim("fp1", "homelab", nil, "alice", "mine"); err != nil {
		t.Fatalf("SetClaim: %v", err)
	}

	// The homelab alert is claimed.
	homelab, err := s.GetActiveClaim("fp1", "homelab")
	if err != nil {
		t.Fatalf("GetActiveClaim homelab: %v", err)
	}
	if homelab == nil || homelab.ClaimedBy != "alice" {
		t.Fatalf("homelab claim = %+v, want claim by alice", homelab)
	}

	// The test-cluster alert with the SAME fingerprint must NOT be claimed.
	other, err := s.GetActiveClaim("fp1", "test")
	if err != nil {
		t.Fatalf("GetActiveClaim test: %v", err)
	}
	if other != nil {
		t.Fatalf("claim leaked to other cluster: %+v", other)
	}

	// Batched query must expose exactly one claim, keyed by the homelab cluster.
	claims, err := s.GetActiveClaims()
	if err != nil {
		t.Fatalf("GetActiveClaims: %v", err)
	}
	if len(claims) != 1 {
		t.Fatalf("active claims = %d, want 1", len(claims))
	}
	if claims[ClaimKey{Fingerprint: "fp1", ClusterName: "homelab"}] == nil {
		t.Errorf("expected claim under homelab key, got %v", claims)
	}
	if _, ok := claims[ClaimKey{Fingerprint: "fp1", ClusterName: "test"}]; ok {
		t.Errorf("claim must not exist under test-cluster key")
	}
}

// TestRecorder_ClaimAttachedPerCluster verifies the poll loop attaches an active
// claim only to the alert in the matching cluster, even when two alerts in the
// snapshot share a fingerprint.
func TestRecorder_ClaimAttachedPerCluster(t *testing.T) {
	rec, _ := newTestRecorder(t)
	ctx := context.Background()

	// Two alerts, same fingerprint, different clusters (a grouped twin).
	snapshot := []models.EnrichedAlert{
		makeEnrichedAlert("fp1", "active", "homelab"),
		makeEnrichedAlert("fp1", "active", "test"),
	}
	rec.processAlerts(ctx, snapshot)

	// Claim only the homelab twin.
	if _, err := rec.store.SetClaim("fp1", "homelab", nil, "alice", "mine"); err != nil {
		t.Fatalf("SetClaim: %v", err)
	}

	// Next poll must attach the claim to homelab only.
	rec.processAlerts(ctx, snapshot)

	var homelabClaim, testClaim *models.Claim
	var seenHomelab, seenTest bool
	for _, a := range rec.alertStore.Get() {
		switch a.ClusterName {
		case "homelab":
			seenHomelab = true
			homelabClaim = a.ActiveClaim
		case "test":
			seenTest = true
			testClaim = a.ActiveClaim
		}
	}
	if !seenHomelab || !seenTest {
		t.Fatalf("expected both clusters present (homelab=%v test=%v)", seenHomelab, seenTest)
	}
	if homelabClaim == nil || homelabClaim.ClaimedBy != "alice" {
		t.Errorf("homelab claim = %+v, want claim by alice", homelabClaim)
	}
	if testClaim != nil {
		t.Errorf("test-cluster alert must not carry a claim, got %+v", testClaim)
	}
}
