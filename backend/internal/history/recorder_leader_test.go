package history

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	"github.com/kj187/jarvis/backend/internal/models"
)

// fakeElector is a test double for the elector interface (D3 step 4 gating).
// Subscribe fires fn immediately with the current state, matching the real
// Elector contract (leader.StaticElector/leader.PGElector both do the same).
type fakeElector struct {
	mu     sync.Mutex
	leader bool
	subs   []func(bool)
}

func (f *fakeElector) IsLeader() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.leader
}

func (f *fakeElector) Subscribe(fn func(bool)) {
	f.mu.Lock()
	f.subs = append(f.subs, fn)
	leader := f.leader
	f.mu.Unlock()
	fn(leader)
}

func (f *fakeElector) setLeader(v bool) {
	f.mu.Lock()
	f.leader = v
	subs := make([]func(bool), len(f.subs))
	copy(subs, f.subs)
	f.mu.Unlock()
	for _, fn := range subs {
		fn(v)
	}
}

// TestRecorder_Follower_SkipsHistoryWrites is the core D3-step-4 regression
// test: a follower must not write alert_events rows, even though it still
// polls (in this slice) and updates its own in-memory AlertStore.
func TestRecorder_Follower_SkipsHistoryWrites(t *testing.T) {
	rec, _ := newTestRecorder(t)
	rec.elector = &fakeElector{leader: false}
	ctx := context.Background()

	rec.processAlerts(ctx, []models.EnrichedAlert{makeEnrichedAlert("fp1", "active", "homelab")})
	rec.processAlerts(ctx, []models.EnrichedAlert{}) // alert disappears → would-be resolve

	events, _, err := rec.store.GetHistoryForCluster("fp1", "homelab", 10, 0)
	if err != nil {
		t.Fatalf("GetHistoryForCluster: %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("follower must not write history, got %d events", len(events))
	}

	// The in-memory view must still reflect the alert (every pod serves
	// reads/WS regardless of leadership) — Get() includes the resolved buffer.
	found := false
	for _, a := range rec.alertStore.Get() {
		if a.Fingerprint == "fp1" {
			found = true
		}
	}
	if !found {
		t.Error("follower must still update its own in-memory AlertStore")
	}
}

// TestRecorder_Leader_WritesHistory is the positive counterpart: an explicit
// elector reporting leader=true behaves exactly like the nil-elector default.
func TestRecorder_Leader_WritesHistory(t *testing.T) {
	rec, _ := newTestRecorder(t)
	rec.elector = &fakeElector{leader: true}
	ctx := context.Background()

	rec.processAlerts(ctx, []models.EnrichedAlert{makeEnrichedAlert("fp1", "active", "homelab")})
	rec.processAlerts(ctx, []models.EnrichedAlert{})

	events, _, err := rec.store.GetHistoryForCluster("fp1", "homelab", 10, 0)
	if err != nil {
		t.Fatalf("GetHistoryForCluster: %v", err)
	}
	if len(events) == 0 {
		t.Fatal("leader must write history")
	}
	if events[0].Status != models.EventStatusResolved {
		t.Errorf("newest event status = %q, want resolved", events[0].Status)
	}
}

// TestRecorder_ReconcileStartupResolves_GatedByLeadership verifies D3 item 4:
// a follower must not run startup reconciliation; the moment it is promoted,
// its next poll picks the reconciliation up exactly once.
func TestRecorder_ReconcileStartupResolves_GatedByLeadership(t *testing.T) {
	amA := newFakeAM(t, nil) // no alerts — this fingerprint actually resolved while this pod was a follower.

	rec, _ := newTestRecorder(t)
	el := &fakeElector{leader: false}
	rec.elector = el
	rec.registry = cluster.NewRegistry([]config.ClusterConfig{
		{Name: "a", AlertmanagerURL: amA.srv.URL, AlertmanagerLinkURL: amA.srv.URL},
	})

	if err := rec.store.UpsertFingerprint("fp-x", "TestAlert", "a", nil); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	if _, _, err := rec.store.RecordStatusChange("fp-x", "a", amA.srv.URL, models.EventStatusFiring, time.Now().Add(-2*time.Hour), nil); err != nil {
		t.Fatalf("RecordStatusChange: %v", err)
	}

	// Follower polls: must NOT reconcile (still just the original firing row).
	rec.poll(context.Background())
	if got := alertEventStatuses(t, rec, "fp-x", "a"); len(got) != 1 || got[0] != models.EventStatusFiring {
		t.Fatalf("events after follower poll = %v, want [firing] (follower must not reconcile)", got)
	}

	// Promoted to leader: next poll reconciles exactly once.
	el.setLeader(true)
	rec.poll(context.Background())
	if got := alertEventStatuses(t, rec, "fp-x", "a"); len(got) != 2 || got[0] != models.EventStatusResolved {
		t.Fatalf("events after promotion poll = %v, want [resolved firing]", got)
	}
}

// TestRecorder_DelayedClaimRelease_SkippedIfDemotedBeforeFiring verifies the
// re-check inside the delayed claim-release goroutine: leadership can change
// during claimReleaseDelay, and a demoted pod must not release the claim.
func TestRecorder_DelayedClaimRelease_SkippedIfDemotedBeforeFiring(t *testing.T) {
	rec, _ := newTestRecorder(t)
	el := &fakeElector{leader: true}
	rec.elector = el
	ctx := context.Background()

	rec.processAlerts(ctx, []models.EnrichedAlert{makeEnrichedAlert("fp1", "active", "homelab")})
	if _, err := rec.store.SetClaim("fp1", "homelab", nil, "alice", ""); err != nil {
		t.Fatalf("SetClaim: %v", err)
	}

	// Resolve while still leader — this schedules the delayed release goroutine.
	rec.processAlerts(ctx, []models.EnrichedAlert{})

	// Demote before claimReleaseDelay (10ms in tests) elapses.
	el.setLeader(false)

	time.Sleep(5 * rec.claimReleaseDelay)

	c, _ := rec.store.GetActiveClaim("fp1", "homelab")
	if c == nil {
		t.Error("claim must survive when this pod is demoted before the delayed release fires")
	}
}
