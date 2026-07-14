package history

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/alertmanager"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	"github.com/kj187/jarvis/backend/internal/leader"
	"github.com/kj187/jarvis/backend/internal/metrics"
	"github.com/kj187/jarvis/backend/internal/models"
)

// Multi-replica integration tests (docs/persistence.md, slice 2): two
// full Recorders, each with its own real leader.PGElector, sharing one
// PostgreSQL database and one fake Alertmanager. These are the two-instance
// TDD scenarios the plan asks for — "exactly one polls", "follower store
// contents converge to leader's", "leader kill → follower promotes, polls,
// and records the catch-up correctly" — plus a grace-period-across-handoff
// regression check (Critical Invariant #1 must survive a leadership change
// mid-episode).

func multiReplicaTestLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// waitFor polls cond every 20ms until it returns true or timeout elapses,
// failing the test in the latter case. Mirrors internal/leader's test helper
// of the same name.
func waitFor(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("condition not met within %v", timeout)
}

// newMultiReplicaTestRecorder builds one "pod": its own Store (already
// opened against the shared test database), its own real PGElector (fast
// retry interval so tests don't wait multiple real seconds), its own
// registry pointing at the shared fake AM, and its own mockHub — wired
// exactly like cmd/jarvis/main.go wires a real Recorder.
func newMultiReplicaTestRecorder(t *testing.T, store *Store, dsn, amURL string, pollInterval time.Duration) (*Recorder, *leader.PGElector, *mockHub) {
	t.Helper()
	el := leader.NewPGElector(dsn, multiReplicaTestLogger())
	el.SetRetryInterval(300 * time.Millisecond)

	hub := &mockHub{}
	registry := cluster.NewRegistry([]config.ClusterConfig{
		{Name: "a", AlertmanagerURL: amURL, AlertmanagerLinkURL: amURL},
	})
	rec := NewRecorder(
		registry, &AlertStore{}, NewSilenceStore(), store, hub,
		pollInterval, multiReplicaTestLogger(), metrics.New("test-multireplica"),
		2*time.Second, el, dsn,
	)
	return rec, el, hub
}

func TestMultiReplica_OnlyLeaderPolls_FollowerConverges(t *testing.T) {
	dsn := postgresTestDSN(t)
	amA := newFakeAM(t, nil)
	amA.setAlerts([]alertmanager.GettableAlert{
		{
			Fingerprint: "fp1",
			Status:      alertmanager.GettableAlertStatus{State: "active"},
			Labels:      map[string]string{"alertname": "TestAlert"},
			Annotations: map[string]string{},
			StartsAt:    time.Now().UTC(),
		},
	})

	stores := newTestPostgresStores(t, 2)
	const pollInterval = 400 * time.Millisecond
	recA, elA, _ := newMultiReplicaTestRecorder(t, stores[0], dsn, amA.srv.URL, pollInterval)
	recB, elB, _ := newMultiReplicaTestRecorder(t, stores[1], dsn, amA.srv.URL, pollInterval)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go elA.Run(ctx)
	go elB.Run(ctx)
	go recA.Start(ctx)
	go recB.Start(ctx)

	waitFor(t, 8*time.Second, func() bool { return elA.IsLeader() || elB.IsLeader() })

	leaderRec, followerRec := recA, recB
	if elB.IsLeader() {
		leaderRec, followerRec = recB, recA
	}

	// The leader must actually poll: its own AlertStore gets populated from
	// AM within a couple of poll intervals.
	waitFor(t, 5*time.Second, func() bool { return len(leaderRec.alertStore.Get()) > 0 })

	// The follower must converge via the snapshot path — its AlertStore ends
	// up non-empty too — without ever polling AM itself: its own
	// cluster.Cluster (a different object from the leader's) never had
	// FetchAlerts called on it, so MemberUpStates on the follower's own
	// registry stays empty, while ClusterUpStates() (the metrics-facing view,
	// sourced from the consumed snapshot on a follower) is populated.
	waitFor(t, 8*time.Second, func() bool { return len(followerRec.alertStore.Get()) > 0 })

	if got := followerRec.registry.All()[0].MemberUpStates(); len(got) != 0 {
		t.Errorf("follower's own cluster.Cluster MemberUpStates = %v, want empty (it must never poll AM itself)", got)
	}
	if got := followerRec.ClusterUpStates(); len(got["a"]) == 0 {
		t.Error("follower's ClusterUpStates() must be populated from the consumed snapshot")
	}

	followerAlerts := followerRec.alertStore.Get()
	if len(followerAlerts) != 1 || followerAlerts[0].Fingerprint != "fp1" {
		t.Fatalf("follower alerts = %+v, want exactly fp1 (converged from leader's snapshot)", followerAlerts)
	}
}

func TestMultiReplica_Failover_PromotesAndReconciles(t *testing.T) {
	dsn := postgresTestDSN(t)
	amA := newFakeAM(t, nil)
	amA.setAlerts([]alertmanager.GettableAlert{
		{
			Fingerprint: "fp-failover",
			Status:      alertmanager.GettableAlertStatus{State: "active"},
			Labels:      map[string]string{"alertname": "TestAlert"},
			Annotations: map[string]string{},
			StartsAt:    time.Now().UTC(),
		},
	})

	stores := newTestPostgresStores(t, 2)
	const pollInterval = 400 * time.Millisecond
	recA, elA, _ := newMultiReplicaTestRecorder(t, stores[0], dsn, amA.srv.URL, pollInterval)
	recB, elB, _ := newMultiReplicaTestRecorder(t, stores[1], dsn, amA.srv.URL, pollInterval)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctxA, cancelA := context.WithCancel(ctx)
	ctxB, cancelB := context.WithCancel(ctx)
	defer cancelA()
	defer cancelB()
	go elA.Run(ctxA)
	go elB.Run(ctxB)
	go recA.Start(ctxA)
	go recB.Start(ctxB)

	waitFor(t, 8*time.Second, func() bool { return elA.IsLeader() || elB.IsLeader() })

	leaderRec, leaderCancel := recA, cancelA
	followerRec, followerElector := recB, elB
	if elB.IsLeader() {
		leaderRec, leaderCancel = recB, cancelB
		followerRec, followerElector = recA, elA
	}

	// Leader records the initial firing episode.
	waitFor(t, 5*time.Second, func() bool {
		events, _, err := leaderRec.store.GetHistoryForCluster("fp-failover", "a", 10, 0)
		return err == nil && len(events) > 0
	})

	// Simulate the leader's pod being killed.
	leaderCancel()

	// The follower must be promoted...
	waitFor(t, 8*time.Second, func() bool { return followerElector.IsLeader() })
	// ...and start polling + writing history itself (D3: leader-only writes).
	waitFor(t, 8*time.Second, func() bool {
		events, _, err := followerRec.store.GetHistoryForCluster("fp-failover", "a", 10, 0)
		return err == nil && len(events) > 0
	})

	events, _, err := followerRec.store.GetHistoryForCluster("fp-failover", "a", 10, 0)
	if err != nil {
		t.Fatalf("GetHistoryForCluster: %v", err)
	}
	if events[0].Status != models.EventStatusFiring {
		t.Errorf("newest event after failover = %q, want firing (alert never actually resolved)", events[0].Status)
	}

	// Now resolve on AM, then re-fire within the grace period — Critical
	// Invariant #1 must still reopen the same episode even though the
	// episode started under the OLD leader and continues under the NEW one.
	amA.setAlerts(nil)
	waitFor(t, 5*time.Second, func() bool {
		events, _, err := followerRec.store.GetHistoryForCluster("fp-failover", "a", 10, 0)
		return err == nil && len(events) > 0 && events[0].Status == models.EventStatusResolved
	})

	amA.setAlerts([]alertmanager.GettableAlert{
		{
			Fingerprint: "fp-failover",
			Status:      alertmanager.GettableAlertStatus{State: "active"},
			Labels:      map[string]string{"alertname": "TestAlert"},
			Annotations: map[string]string{},
			StartsAt:    time.Now().UTC(),
		},
	})
	waitFor(t, 5*time.Second, func() bool {
		events, _, err := followerRec.store.GetHistoryForCluster("fp-failover", "a", 10, 0)
		return err == nil && len(events) > 0 && events[0].Status == models.EventStatusFiring
	})

	stats, err := followerRec.store.GetStatsForCluster("fp-failover", "a")
	if err != nil {
		t.Fatalf("GetStatsForCluster: %v", err)
	}
	if stats.OccurrenceCount != 1 {
		t.Errorf("OccurrenceCount after grace-period reopen across handoff = %d, want 1 (reopen, not a new episode)", stats.OccurrenceCount)
	}
	events, _, err = followerRec.store.GetHistoryForCluster("fp-failover", "a", 10, 0)
	if err != nil {
		t.Fatalf("GetHistoryForCluster: %v", err)
	}
	if len(events) != 1 {
		t.Errorf("events after grace-period reopen = %d, want 1 (resolved row deleted, original firing row reused)", len(events))
	}
}

// TestMultiReplica_FollowerTrigger_ForwardsToLeader is the regression test
// for D3 item 7: a follower cannot poll itself, so its Trigger() call must
// forward to the leader via pg_notify(jarvis_trigger, ...), and the leader's
// runPollLoop must LISTEN for it and poll immediately rather than waiting up
// to a full (deliberately long, here) poll interval.
func TestMultiReplica_FollowerTrigger_ForwardsToLeader(t *testing.T) {
	dsn := postgresTestDSN(t)
	amA := newFakeAM(t, nil) // starts with no alerts

	stores := newTestPostgresStores(t, 2)
	const longPollInterval = 10 * time.Second // long enough that a passing test proves the forward path, not just waiting it out
	recA, elA, _ := newMultiReplicaTestRecorder(t, stores[0], dsn, amA.srv.URL, longPollInterval)
	recB, elB, _ := newMultiReplicaTestRecorder(t, stores[1], dsn, amA.srv.URL, longPollInterval)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go elA.Run(ctx)
	go elB.Run(ctx)
	go recA.Start(ctx)
	go recB.Start(ctx)

	waitFor(t, 8*time.Second, func() bool { return elA.IsLeader() || elB.IsLeader() })
	followerRec := recB
	if elB.IsLeader() {
		followerRec = recA
	}

	// The initial (empty) poll has already happened by now (Start polls
	// immediately). Add an alert on AM, then trigger via the FOLLOWER —
	// never the leader — and expect it to show up well before
	// longPollInterval would have elapsed on its own.
	amA.setAlerts([]alertmanager.GettableAlert{
		{
			Fingerprint: "fp-trigger",
			Status:      alertmanager.GettableAlertStatus{State: "active"},
			Labels:      map[string]string{"alertname": "TestAlert"},
			Annotations: map[string]string{},
			StartsAt:    time.Now().UTC(),
		},
	})
	followerRec.Trigger()

	waitFor(t, 5*time.Second, func() bool {
		for _, a := range followerRec.alertStore.Get() {
			if a.Fingerprint == "fp-trigger" {
				return true
			}
		}
		return false
	})
}

