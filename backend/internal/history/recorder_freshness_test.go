package history

import (
	"bytes"
	"compress/gzip"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/kj187/jarvis/backend/internal/alertmanager"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	"github.com/kj187/jarvis/backend/internal/models"
)

// freshnessClock is a settable clock for Recorder.now.
type freshnessClock struct{ t time.Time }

func (c *freshnessClock) now() time.Time          { return c.t }
func (c *freshnessClock) advance(d time.Duration) { c.t = c.t.Add(d) }

func newFreshnessRecorder(t *testing.T, interval time.Duration, am *fakeAM) (*Recorder, *freshnessClock) {
	t.Helper()
	rec, _ := newTestRecorder(t)
	clock := &freshnessClock{t: time.Date(2026, 10, 2, 8, 0, 0, 0, time.UTC)}
	rec.now = clock.now
	rec.startedAt = clock.t
	rec.interval = interval
	rec.registry = cluster.NewRegistry([]config.ClusterConfig{
		{Name: "a", AlertmanagerURL: am.srv.URL, AlertmanagerLinkURL: am.srv.URL},
	})
	return rec, clock
}

// An Alertmanager that stays unreachable for a long time must not leave the
// cluster looking fresh: the last good alerts keep showing as firing, so the
// age of that data has to be reported honestly.
func TestC_LongAMOutage_StaleShownAsFiring(t *testing.T) {
	am := newFakeAM(t, nil)
	am.setAlerts(testAMAlerts("fp1"))
	rec, clock := newFreshnessRecorder(t, 10*time.Second, am)
	ctx := t.Context()

	rec.poll(ctx)
	firstSuccess := clock.t
	if f := rec.ClusterFreshness()["a"]; f.Stale || !f.LastSuccessAt.Equal(firstSuccess) {
		t.Fatalf("after a good poll: %+v, want fresh with LastSuccessAt=%v", f, firstSuccess)
	}

	am.setFailAlerts(true)
	clock.advance(10 * time.Minute)
	rec.poll(ctx)

	got := rec.alertStore.Get()
	if len(got) != 1 || got[0].Status.State != "active" {
		t.Fatalf("alertStore = %+v, want the last good alert still shown as active", got)
	}
	f := rec.ClusterFreshness()["a"]
	if !f.Stale {
		t.Errorf("Stale = false after a 10 minute outage, want true")
	}
	if !f.LastSuccessAt.Equal(firstSuccess) {
		t.Errorf("LastSuccessAt = %v, want the last successful poll %v", f.LastSuccessAt, firstSuccess)
	}
	if v := testutil.ToFloat64(rec.metrics.SnapshotStale); v != 1 {
		t.Errorf("jarvis_snapshot_stale = %v, want 1", v)
	}

	am.setFailAlerts(false)
	clock.advance(10 * time.Second)
	rec.poll(ctx)
	f = rec.ClusterFreshness()["a"]
	if f.Stale || !f.LastSuccessAt.Equal(clock.t) {
		t.Errorf("after recovery: %+v, want fresh with LastSuccessAt=%v", f, clock.t)
	}
	if v := testutil.ToFloat64(rec.metrics.SnapshotStale); v != 0 {
		t.Errorf("jarvis_snapshot_stale = %v after recovery, want 0", v)
	}
}

func TestClusterFreshness_ThresholdIsMaxOfThreeIntervalsAndSixtySeconds(t *testing.T) {
	cases := []struct {
		name     string
		interval time.Duration
		age      time.Duration
		stale    bool
	}{
		{"floor: at 60s", 10 * time.Second, 60 * time.Second, false},
		{"floor: past 60s", 10 * time.Second, 61 * time.Second, true},
		{"3x interval: at 180s", time.Minute, 180 * time.Second, false},
		{"3x interval: past 180s", time.Minute, 181 * time.Second, true},
		{"3x interval beats the floor", 30 * time.Second, 80 * time.Second, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			am := newFakeAM(t, nil)
			rec, clock := newFreshnessRecorder(t, tc.interval, am)
			rec.poll(t.Context())
			am.setFailAlerts(true)
			clock.advance(tc.age)
			rec.poll(t.Context())
			if got := rec.ClusterFreshness()["a"].Stale; got != tc.stale {
				t.Errorf("Stale = %v at age %v (interval %v), want %v", got, tc.age, tc.interval, tc.stale)
			}
		})
	}
}

// A cluster that has never answered has no LastSuccessAt; it becomes stale
// once this pod has been trying for longer than the threshold.
func TestClusterFreshness_NeverSucceeded(t *testing.T) {
	am := newFakeAM(t, nil)
	am.setFailAlerts(true)
	rec, clock := newFreshnessRecorder(t, 10*time.Second, am)

	clock.advance(30 * time.Second)
	rec.poll(t.Context())
	if f := rec.ClusterFreshness()["a"]; f.Stale || !f.LastSuccessAt.IsZero() {
		t.Fatalf("after 30s: %+v, want not stale and no LastSuccessAt", f)
	}

	clock.advance(31 * time.Second)
	rec.poll(t.Context())
	if f := rec.ClusterFreshness()["a"]; !f.Stale || !f.LastSuccessAt.IsZero() {
		t.Fatalf("after 61s: %+v, want stale and still no LastSuccessAt", f)
	}
}

func TestClusterFreshness_FollowerUsesSnapshotLastSuccess(t *testing.T) {
	am := newFakeAM(t, nil)
	rec, clock := newFreshnessRecorder(t, 10*time.Second, am)
	rec.elector = &fakeElector{leader: false}
	rec.followerSnapshots = map[string]followerSnapshotEntry{}

	lastOK := clock.t.Add(-10 * time.Minute)
	rec.followerSnapshots["a"] = followerSnapshotEntry{takenAt: clock.t, lastSuccessAt: lastOK}
	f := rec.ClusterFreshness()["a"]
	if !f.Stale || !f.LastSuccessAt.Equal(lastOK) {
		t.Fatalf("follower with an old lastSuccessAt but a fresh snapshot: %+v, want stale with LastSuccessAt=%v", f, lastOK)
	}

	// A snapshot from a Jarvis version that does not know the field: the
	// snapshot's own age is the best available information.
	rec.followerSnapshots["a"] = followerSnapshotEntry{takenAt: clock.t.Add(-5 * time.Minute)}
	f = rec.ClusterFreshness()["a"]
	if !f.Stale || !f.LastSuccessAt.Equal(clock.t.Add(-5*time.Minute)) {
		t.Fatalf("follower with a legacy snapshot: %+v, want stale with LastSuccessAt=takenAt", f)
	}

	rec.followerSnapshots["a"] = followerSnapshotEntry{takenAt: clock.t, lastSuccessAt: clock.t}
	if f = rec.ClusterFreshness()["a"]; f.Stale {
		t.Fatalf("follower with a fresh snapshot: %+v, want not stale", f)
	}
}

func TestSnapshot_LastSuccessAt_RoundTripAndLegacyPayload(t *testing.T) {
	when := time.Date(2026, 10, 2, 7, 59, 0, 0, time.UTC)
	payload, err := encodeSnapshot(pollSnapshot{LastSuccessAt: &when})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	got, err := decodeSnapshot(payload)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.LastSuccessAt == nil || !got.LastSuccessAt.Equal(when) {
		t.Fatalf("LastSuccessAt = %v, want %v", got.LastSuccessAt, when)
	}

	// Payload written by a pod that predates the field.
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	_, _ = gw.Write([]byte(`{"alerts":[],"silences":[],"memberUp":{}}`))
	_ = gw.Close()
	legacy, err := decodeSnapshot(buf.Bytes())
	if err != nil {
		t.Fatalf("decode legacy: %v", err)
	}
	if legacy.LastSuccessAt != nil {
		t.Errorf("legacy LastSuccessAt = %v, want nil", legacy.LastSuccessAt)
	}
}

func testAMAlerts(fp string) []alertmanager.GettableAlert {
	return []alertmanager.GettableAlert{{
		Fingerprint: fp,
		Status:      alertmanager.GettableAlertStatus{State: "active"},
		Labels:      map[string]string{"alertname": "TestAlert"},
		Annotations: map[string]string{},
		StartsAt:    time.Now().UTC(),
	}}
}

// The snapshot row must carry the time of the last successful poll, not the
// time of the write: after an outage taken_at keeps moving, LastSuccessAt must not.
func TestFreshness_PersistedSnapshotKeepsLastSuccessAcrossOutage(t *testing.T) {
	dsn := postgresTestDSN(t)
	store := newTestPostgresStores(t, 1)[0]
	am := newFakeAM(t, nil)
	am.setAlerts(testAMAlerts("fp1"))
	rec := newFreshLeaderRecorder(t, store, dsn,
		config.ClusterConfig{Name: "a", AlertmanagerURL: am.srv.URL, AlertmanagerLinkURL: am.srv.URL})
	clock := &freshnessClock{t: time.Date(2026, 10, 2, 8, 0, 0, 0, time.UTC)}
	rec.now = clock.now
	rec.startedAt = clock.t

	rec.poll(t.Context())
	am.setFailAlerts(true)
	clock.advance(10 * time.Minute)
	rec.poll(t.Context())

	row, found, err := store.GetSnapshot(t.Context(), "a")
	if err != nil || !found {
		t.Fatalf("GetSnapshot: found=%v err=%v", found, err)
	}
	snap, err := decodeSnapshot(row.Payload)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := time.Date(2026, 10, 2, 8, 0, 0, 0, time.UTC)
	if snap.LastSuccessAt == nil || !snap.LastSuccessAt.Equal(want) {
		t.Fatalf("snapshot LastSuccessAt = %v, want the last successful poll %v", snap.LastSuccessAt, want)
	}
}

// A fresh leader whose Alertmanager is down inherits the age of the data it
// carries over from the previous leader's snapshot.
func TestFreshness_FreshLeaderInheritsLastSuccessFromSnapshot(t *testing.T) {
	dsn := postgresTestDSN(t)
	store := newTestPostgresStores(t, 1)[0]
	lastOK := time.Now().UTC().Add(-10 * time.Minute).Truncate(time.Second)
	payload, err := encodeSnapshot(pollSnapshot{
		Alerts:        []models.EnrichedAlert{snapshotAlert("a", "fp-prev-leader")},
		LastSuccessAt: &lastOK,
	})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if err := store.PersistSnapshot(t.Context(), "a", payload, time.Now().UTC()); err != nil {
		t.Fatalf("persist: %v", err)
	}

	am := newFakeAM(t, nil)
	am.setFailAlerts(true)
	rec := newFreshLeaderRecorder(t, store, dsn,
		config.ClusterConfig{Name: "a", AlertmanagerURL: am.srv.URL, AlertmanagerLinkURL: am.srv.URL})
	rec.poll(t.Context())

	f := rec.ClusterFreshness()["a"]
	if !f.Stale || !f.LastSuccessAt.Equal(lastOK) {
		t.Fatalf("freshness = %+v, want stale with LastSuccessAt=%v from the snapshot", f, lastOK)
	}
}
