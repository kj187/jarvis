package history

import (
	"context"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/alertmanager"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	"github.com/kj187/jarvis/backend/internal/metrics"
	"github.com/kj187/jarvis/backend/internal/models"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

// A freshly elected leader has no in-memory lastGoodAlerts. If Alertmanager is
// down for a cluster when it takes over, that cluster must keep the alerts of
// the previous leader's poll_snapshots row instead of being persisted and
// broadcast as empty (Critical Invariant #14 across a leadership change).

func snapshotAlert(clusterName, fingerprint string) models.EnrichedAlert {
	return models.EnrichedAlert{
		Fingerprint: fingerprint,
		ClusterName: clusterName,
		Status:      models.AlertStatus{State: "active"},
		Labels:      map[string]string{"alertname": "Seeded"},
		Annotations: map[string]string{},
		StartsAt:    time.Now().UTC().Add(-time.Hour),
	}
}

func persistTestSnapshot(t *testing.T, store *Store, clusterName string, alerts ...models.EnrichedAlert) {
	t.Helper()
	payload, err := encodeSnapshot(pollSnapshot{
		Alerts:   alerts,
		Silences: []alertmanager.GettableSilence{makeSilence("sil-"+clusterName, "active")},
		MemberUp: map[string]bool{"member": true},
	})
	if err != nil {
		t.Fatalf("encode snapshot: %v", err)
	}
	if err := store.PersistSnapshot(context.Background(), clusterName, payload, time.Now().UTC()); err != nil {
		t.Fatalf("persist snapshot %s: %v", clusterName, err)
	}
}

func snapshotFingerprints(t *testing.T, store *Store, clusterName string) (fps []string, found bool) {
	t.Helper()
	row, found, err := store.GetSnapshot(context.Background(), clusterName)
	if err != nil {
		t.Fatalf("get snapshot %s: %v", clusterName, err)
	}
	if !found {
		return nil, false
	}
	snap, err := decodeSnapshot(row.Payload)
	if err != nil {
		t.Fatalf("decode snapshot %s: %v", clusterName, err)
	}
	for _, a := range snap.Alerts {
		fps = append(fps, a.Fingerprint)
	}
	return fps, true
}

// runLeaderPolls runs the leader poll loop until its second poll cycle has
// started (polls are sequential, so the first one, including its snapshot
// persistence, is then complete), then stops it and waits for it to return so
// the test can read the stores race-free.
func runLeaderPolls(t *testing.T, rec *Recorder) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		rec.runPollLoop(ctx)
	}()
	waitFor(t, 20*time.Second, func() bool {
		return testutil.ToFloat64(rec.metrics.PollCyclesTotal.WithLabelValues("a")) >= 2
	})
	cancel()
	<-done
}

func newFreshLeaderRecorder(t *testing.T, store *Store, dsn string, clusters ...config.ClusterConfig) *Recorder {
	t.Helper()
	return NewRecorder(
		cluster.NewRegistry(clusters), &AlertStore{}, NewSilenceStore(), store, &mockHub{},
		100*time.Millisecond, multiReplicaTestLogger(), metrics.New("test-fresh-leader"),
		2*time.Second, nil, dsn,
	)
}

func TestFreshLeaderAMDown_KeepsSnapshotAlerts(t *testing.T) {
	dsn := postgresTestDSN(t)
	store := newTestPostgresStores(t, 1)[0]
	withClaim := snapshotAlert("a", "fp-prev-leader")
	withClaim.ActiveClaim = &models.Claim{Fingerprint: "fp-prev-leader", ClusterName: "a", ClaimedBy: "gone"}
	persistTestSnapshot(t, store, "a", withClaim)

	amA := newFakeAM(t, nil)
	amA.setFailAlerts(true)
	rec := newFreshLeaderRecorder(t, store, dsn,
		config.ClusterConfig{Name: "a", AlertmanagerURL: amA.srv.URL, AlertmanagerLinkURL: amA.srv.URL})

	runLeaderPolls(t, rec)

	got := rec.alertStore.Get()
	if len(got) != 1 || got[0].Fingerprint != "fp-prev-leader" || got[0].Status.State == "resolved" {
		t.Fatalf("alertStore = %+v, want the previous leader's alert fp-prev-leader still live", got)
	}
	if got[0].ActiveClaim != nil {
		t.Errorf("ActiveClaim = %+v, want nil: claims come from the database, not from the old snapshot", got[0].ActiveClaim)
	}
	fps, found := snapshotFingerprints(t, store, "a")
	if !found || len(fps) != 1 || fps[0] != "fp-prev-leader" {
		t.Fatalf("persisted snapshot = %v (found=%v), want [fp-prev-leader]", fps, found)
	}
	if sils := rec.silenceStore.GetCluster("a"); len(sils) != 1 {
		t.Errorf("silence store for a = %d silences, want the 1 from the previous snapshot", len(sils))
	}
}

func TestFreshLeaderAMDown_NoSnapshotRow_WritesNothing(t *testing.T) {
	dsn := postgresTestDSN(t)
	store := newTestPostgresStores(t, 1)[0]

	amA := newFakeAM(t, nil)
	amA.setFailAlerts(true)
	rec := newFreshLeaderRecorder(t, store, dsn,
		config.ClusterConfig{Name: "a", AlertmanagerURL: amA.srv.URL, AlertmanagerLinkURL: amA.srv.URL})

	runLeaderPolls(t, rec)

	if fps, found := snapshotFingerprints(t, store, "a"); found {
		t.Fatalf("persisted snapshot for a = %v, want no row (nothing known about the cluster)", fps)
	}
}

func TestFreshLeaderAMDown_TwoClusters_OnlyHealthyOneUpdates(t *testing.T) {
	dsn := postgresTestDSN(t)
	store := newTestPostgresStores(t, 1)[0]
	persistTestSnapshot(t, store, "a", snapshotAlert("a", "fp-a"))
	persistTestSnapshot(t, store, "b", snapshotAlert("b", "fp-b-old"))

	amA := newFakeAM(t, nil)
	amA.setFailAlerts(true)
	amB := newFakeAM(t, nil)
	amB.setAlerts([]alertmanager.GettableAlert{{
		Fingerprint: "fp-b-new",
		Status:      alertmanager.GettableAlertStatus{State: "active"},
		Labels:      map[string]string{"alertname": "Fresh"},
		Annotations: map[string]string{},
		StartsAt:    time.Now().UTC(),
	}})
	rec := newFreshLeaderRecorder(t, store, dsn,
		config.ClusterConfig{Name: "a", AlertmanagerURL: amA.srv.URL, AlertmanagerLinkURL: amA.srv.URL},
		config.ClusterConfig{Name: "b", AlertmanagerURL: amB.srv.URL, AlertmanagerLinkURL: amB.srv.URL},
	)

	runLeaderPolls(t, rec)

	byFP := map[string]models.EnrichedAlert{}
	for _, a := range rec.alertStore.Get() {
		byFP[a.Fingerprint] = a
	}
	if _, ok := byFP["fp-a"]; !ok || byFP["fp-a"].Status.State == "resolved" {
		t.Errorf("alert fp-a of the failing cluster must stay live, store = %+v", byFP)
	}
	if _, ok := byFP["fp-b-new"]; !ok {
		t.Errorf("alert fp-b-new of the healthy cluster must be present, store = %+v", byFP)
	}
	if _, ok := byFP["fp-b-old"]; ok {
		t.Errorf("fp-b-old must be replaced by the healthy cluster's fresh poll, store = %+v", byFP)
	}
	if fps, _ := snapshotFingerprints(t, store, "a"); len(fps) != 1 || fps[0] != "fp-a" {
		t.Errorf("snapshot a = %v, want [fp-a]", fps)
	}
	if fps, _ := snapshotFingerprints(t, store, "b"); len(fps) != 1 || fps[0] != "fp-b-new" {
		t.Errorf("snapshot b = %v, want [fp-b-new]", fps)
	}
}

// The seeded alerts come from a snapshot, not from Alertmanager: they must not
// write history. An episode the previous leader already resolved (but whose
// snapshot row was not yet rewritten) must stay resolved.
func TestFreshLeaderAMDown_SeededAlertsWriteNoHistory(t *testing.T) {
	dsn := postgresTestDSN(t)
	store := newTestPostgresStores(t, 1)[0]
	store.SetGracePeriod(time.Hour)

	if err := store.UpsertFingerprint("fp-ended", "Seeded", "a", map[string]string{"alertname": "Seeded"}); err != nil {
		t.Fatalf("upsert fingerprint: %v", err)
	}
	if _, _, err := store.RecordStatusChange("fp-ended", "a", "", models.EventStatusFiring, time.Now().UTC().Add(-time.Hour), nil); err != nil {
		t.Fatalf("record firing: %v", err)
	}
	if err := store.RecordResolvedForCluster("fp-ended", "a", time.Now().UTC()); err != nil {
		t.Fatalf("record resolved: %v", err)
	}
	persistTestSnapshot(t, store, "a", snapshotAlert("a", "fp-ended"))

	amA := newFakeAM(t, nil)
	amA.setFailAlerts(true)
	rec := newFreshLeaderRecorder(t, store, dsn,
		config.ClusterConfig{Name: "a", AlertmanagerURL: amA.srv.URL, AlertmanagerLinkURL: amA.srv.URL})

	runLeaderPolls(t, rec)

	events, _, err := store.GetHistoryForCluster("fp-ended", "a", 10, 0)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(events) != 2 || events[0].Status != models.EventStatusResolved {
		t.Fatalf("events = %+v, want the original firing + resolved pair untouched", events)
	}
}

// A pod that led before has an old lastGoodAlerts in memory; the newest
// snapshot row (written by whoever led in between) must replace it.
func TestFreshLeaderAMDown_ReseedsOnEveryTenure(t *testing.T) {
	dsn := postgresTestDSN(t)
	store := newTestPostgresStores(t, 1)[0]
	persistTestSnapshot(t, store, "a", snapshotAlert("a", "fp-newer"))

	amA := newFakeAM(t, nil)
	amA.setFailAlerts(true)
	rec := newFreshLeaderRecorder(t, store, dsn,
		config.ClusterConfig{Name: "a", AlertmanagerURL: amA.srv.URL, AlertmanagerLinkURL: amA.srv.URL})
	rec.lastGoodAlerts["a"] = []models.EnrichedAlert{snapshotAlert("a", "fp-older-own-tenure")}

	runLeaderPolls(t, rec)

	got := rec.alertStore.Get()
	if len(got) != 1 || got[0].Fingerprint != "fp-newer" {
		t.Fatalf("alertStore = %+v, want only fp-newer from the newest snapshot", got)
	}
}

// An unreadable snapshot row is neither a crash nor overwritten.
func TestFreshLeaderAMDown_UndecodableRow_KeptAndIgnored(t *testing.T) {
	dsn := postgresTestDSN(t)
	store := newTestPostgresStores(t, 1)[0]
	if err := store.PersistSnapshot(context.Background(), "a", []byte("not gzip"), time.Now().UTC()); err != nil {
		t.Fatalf("persist garbage: %v", err)
	}

	amA := newFakeAM(t, nil)
	amA.setFailAlerts(true)
	rec := newFreshLeaderRecorder(t, store, dsn,
		config.ClusterConfig{Name: "a", AlertmanagerURL: amA.srv.URL, AlertmanagerLinkURL: amA.srv.URL})

	runLeaderPolls(t, rec)

	if got := rec.alertStore.Get(); len(got) != 0 {
		t.Fatalf("alertStore = %+v, want empty", got)
	}
	row, found, err := store.GetSnapshot(context.Background(), "a")
	if err != nil || !found || string(row.Payload) != "not gzip" {
		t.Fatalf("row = %q found=%v err=%v, want the unreadable row untouched", row.Payload, found, err)
	}
}

// When Alertmanager answers again, an alert that ended during the outage is
// resolved exactly once, with the occurrence count untouched.
func TestFreshLeaderAMDown_Recovery_ResolvesEndedAlertOnce(t *testing.T) {
	dsn := postgresTestDSN(t)
	store := newTestPostgresStores(t, 1)[0]
	store.SetGracePeriod(time.Second)
	if err := store.UpsertFingerprint("fp-ended", "Seeded", "a", map[string]string{"alertname": "Seeded"}); err != nil {
		t.Fatalf("upsert fingerprint: %v", err)
	}
	if _, _, err := store.RecordStatusChange("fp-ended", "a", "", models.EventStatusFiring, time.Now().UTC().Add(-time.Hour), nil); err != nil {
		t.Fatalf("record firing: %v", err)
	}
	persistTestSnapshot(t, store, "a", snapshotAlert("a", "fp-ended"))

	amA := newFakeAM(t, nil)
	amA.setFailAlerts(true)
	rec := newFreshLeaderRecorder(t, store, dsn,
		config.ClusterConfig{Name: "a", AlertmanagerURL: amA.srv.URL, AlertmanagerLinkURL: amA.srv.URL})

	ctx := context.Background()
	rec.poll(ctx)
	amA.setFailAlerts(false)
	rec.poll(ctx)
	rec.poll(ctx)

	events, _, err := store.GetHistoryForCluster("fp-ended", "a", 10, 0)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(events) != 2 || events[0].Status != models.EventStatusResolved || events[1].Status != models.EventStatusFiring {
		t.Fatalf("events = %+v, want firing then exactly one resolved", events)
	}
	stats, err := store.GetStatsForCluster("fp-ended", "a")
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if stats.OccurrenceCount != 1 {
		t.Errorf("OccurrenceCount = %d, want 1 (no second firing)", stats.OccurrenceCount)
	}
}
