package history

import (
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/models"
)

// A follower rebuilds its AlertStore purely from the leader's persisted
// snapshot, which only carries the claims that existed as of the leader's last
// poll. A claim created against any pod after that poll (patched into the
// follower's AlertStore by claims.go, broadcast via fanout) would be wiped on
// the follower's next snapshot resync and only reappear after the leader's next
// poll — the "claim flashes then vanishes until the next load" bug. The
// follower must re-hydrate active claims from the shared DB on every rebuild,
// exactly as the leader does in applyPollResults.
func TestRebuildFollowerAlertStore_RehydratesActiveClaimFromDB(t *testing.T) {
	rec, _ := newTestRecorder(t)
	rec.followerSnapshots = make(map[string]followerSnapshotEntry)

	// Leader snapshot that predates the claim.
	rec.followerSnapshots["a"] = followerSnapshotEntry{
		alerts:  []models.EnrichedAlert{makeEnrichedAlert("fp1", "active", "a")},
		takenAt: time.Now(),
	}

	// Claim created against this (follower) pod after that snapshot was taken.
	if err := rec.store.UpsertFingerprint("fp1", "TestAlert", "a", map[string]string{"alertname": "TestAlert"}); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	if _, err := rec.store.SetClaim("fp1", "a", nil, "alice", "on it"); err != nil {
		t.Fatalf("SetClaim: %v", err)
	}

	rec.rebuildFollowerAlertStore()

	got := rec.alertStore.Get()
	if len(got) != 1 {
		t.Fatalf("alerts = %d, want 1", len(got))
	}
	if got[0].ActiveClaim == nil || got[0].ActiveClaim.ClaimedBy != "alice" {
		t.Fatalf("ActiveClaim = %+v, want claimed by alice (re-hydrated from DB, not the stale leader snapshot)", got[0].ActiveClaim)
	}
}

// The mirror case: the leader snapshot still carries a claim that has since been
// released. The follower's DB re-hydration must clear it, not leave the stale
// claim showing until the leader next polls.
func TestRebuildFollowerAlertStore_ClearsReleasedClaimFromStaleSnapshot(t *testing.T) {
	rec, _ := newTestRecorder(t)
	rec.followerSnapshots = make(map[string]followerSnapshotEntry)

	stale := makeEnrichedAlert("fp1", "active", "a")
	stale.ActiveClaim = &models.Claim{Fingerprint: "fp1", ClusterName: "a", ClaimedBy: "bob"}
	rec.followerSnapshots["a"] = followerSnapshotEntry{
		alerts:  []models.EnrichedAlert{stale},
		takenAt: time.Now(),
	}

	// DB has no active claim for this alert.
	rec.rebuildFollowerAlertStore()

	got := rec.alertStore.Get()
	if len(got) != 1 {
		t.Fatalf("alerts = %d, want 1", len(got))
	}
	if got[0].ActiveClaim != nil {
		t.Fatalf("ActiveClaim = %+v, want nil (DB has no active claim; stale snapshot claim must be dropped)", got[0].ActiveClaim)
	}
}
