package history

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/kj187/jarvis/backend/internal/alertmanager"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/metrics"
	"github.com/kj187/jarvis/backend/internal/models"
)

// mockHub captures broadcast calls for assertions.
type mockHub struct {
	events []broadcastCall
}

type broadcastCall struct {
	eventType string
	payload   interface{}
}

func (m *mockHub) BroadcastJSON(eventType string, payload interface{}) {
	m.events = append(m.events, broadcastCall{eventType: eventType, payload: payload})
}

func newTestRecorder(t *testing.T) (*Recorder, *mockHub) {
	t.Helper()
	database, dialect, err := idb.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := idb.Migrate(database, dialect); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	hub := &mockHub{}
	store := NewStore(database, dialect)
	alertStore := &AlertStore{}
	rec := &Recorder{
		alertStore:        alertStore,
		store:             store,
		hub:               hub,
		interval:          time.Minute,
		logger:            slog.Default(),
		metrics:           metrics.New("test"),
		prevSnapshot:      make(map[string]string),
		prevSilenceInfo:   make(map[string]silenceInfoEntry),
		prevAlertSilences: make(map[string][]string),
		clusterUp:         make(map[string]bool),
		claimReleaseDelay: 10 * time.Millisecond,
	}
	return rec, hub
}

func makeEnrichedAlert(fp, state, clusterName string) models.EnrichedAlert {
	return models.EnrichedAlert{
		Fingerprint:     fp,
		Status:          models.AlertStatus{State: state},
		Labels:          map[string]string{"alertname": "TestAlert", "severity": "critical"},
		Annotations:     map[string]string{},
		StartsAt:        time.Now().UTC(),
		ClusterName:     clusterName,
		AlertmanagerURL: "http://am:9093",
	}
}

func TestRecorder_FiringTransition(t *testing.T) {
	rec, hub := newTestRecorder(t)

	// Simulate poll with one firing alert.
	alerts := []models.EnrichedAlert{makeEnrichedAlert("fp1", "active", "homelab")}
	rec.processAlerts(context.Background(), alerts)

	if len(hub.events) != 1 {
		t.Fatalf("expected 1 broadcast, got %d", len(hub.events))
	}
	if hub.events[0].eventType != models.WSTypeAlertsUpdate {
		t.Errorf("eventType = %q", hub.events[0].eventType)
	}
}

func TestRecorder_ResolvedTransition(t *testing.T) {
	rec, _ := newTestRecorder(t)
	ctx := context.Background()

	// First poll: alert is active.
	alerts := []models.EnrichedAlert{makeEnrichedAlert("fp1", "active", "homelab")}
	rec.processAlerts(ctx, alerts)

	// Second poll: alert is gone → resolved.
	rec.processAlerts(ctx, []models.EnrichedAlert{})

	events, _, err := rec.store.GetHistory("fp1", 10, 0)
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(events) == 0 {
		t.Fatal("expected events")
	}
	if events[0].Status != models.EventStatusResolved {
		t.Errorf("expected resolved status, got %q", events[0].Status)
	}
}

func TestRecorder_SuppressedExpiredTransition(t *testing.T) {
	rec, _ := newTestRecorder(t)
	ctx := context.Background()

	// First poll: active.
	rec.processAlerts(ctx, []models.EnrichedAlert{makeEnrichedAlert("fp1", "active", "homelab")})

	// Second poll: suppressed.
	rec.processAlerts(ctx, []models.EnrichedAlert{makeEnrichedAlert("fp1", "suppressed", "homelab")})

	// Third poll: active again (silence expired).
	rec.processAlerts(ctx, []models.EnrichedAlert{makeEnrichedAlert("fp1", "active", "homelab")})

	events, _, _ := rec.store.GetHistory("fp1", 10, 0)
	// Should have at least 2 events (initial firing + expired/refiring)
	if len(events) < 2 {
		t.Errorf("expected ≥ 2 events for suppressed→expired transition, got %d", len(events))
	}
}

// TestRecorder_SilenceEdit_NoSpuriousExpiredEvent verifies that editing a silence
// (AM replaces old ID with a new one) does not produce a spurious "Silence expired"
// history entry when the alert is still silenced by the new silence.
func TestRecorder_SilenceEdit_NoSpuriousExpiredEvent(t *testing.T) {
	rec, _ := newTestRecorder(t)

	rec.prevSilenceInfo = map[string]silenceInfoEntry{
		"silence-old": {state: "active", clusterName: "homelab", comment: "test"},
	}
	rec.prevAlertSilences = map[string][]string{
		"fp1": {"silence-old"},
	}

	// AM replaced silence-old with silence-new; alert is still silenced.
	currSilenceInfo := map[string]silenceInfoEntry{
		"silence-old": {state: "expired", clusterName: "homelab", comment: "test"},
		"silence-new": {state: "active", clusterName: "homelab", comment: "test"},
	}
	currAlertSilences := map[string][]string{
		"fp1": {"silence-new"},
	}

	entries := rec.collectExpiredSilences(currSilenceInfo, currAlertSilences)
	if len(entries) != 0 {
		t.Errorf("expected 0 expired entries (alert still silenced), got %d", len(entries))
	}
}

// TestRecorder_SilenceTrueExpiry verifies that a genuine silence expiry (alert
// no longer silenced) is recorded.
func TestRecorder_SilenceTrueExpiry(t *testing.T) {
	rec, _ := newTestRecorder(t)

	rec.prevSilenceInfo = map[string]silenceInfoEntry{
		"silence-old": {state: "active", clusterName: "homelab", comment: "test"},
	}
	rec.prevAlertSilences = map[string][]string{
		"fp1": {"silence-old"},
	}

	currSilenceInfo := map[string]silenceInfoEntry{
		"silence-old": {state: "expired", clusterName: "homelab", comment: "test"},
	}
	// Alert no longer silenced.
	currAlertSilences := map[string][]string{}

	entries := rec.collectExpiredSilences(currSilenceInfo, currAlertSilences)
	if len(entries) != 1 {
		t.Errorf("expected 1 expired entry, got %d", len(entries))
	}
}

// processAlerts drives the core recorder logic without needing a real cluster
// registry. It delegates to the production applyPollResults so tests exercise
// the real code path (claim batching, broadcast dedup, silence handling).
func (r *Recorder) processAlerts(ctx context.Context, allAlerts []models.EnrichedAlert) {
	r.applyPollResults(ctx, allAlerts, nil)
}

// TestRecorder_ClaimReleasedAfterGenuineResolution verifies that a claim is
// released after claimReleaseDelay when the alert stays resolved (no re-fire).
func TestRecorder_ClaimReleasedAfterGenuineResolution(t *testing.T) {
	rec, _ := newTestRecorder(t)
	ctx := context.Background()

	rec.processAlerts(ctx, alert("fp1", "active"))
	if _, err := rec.store.SetClaim("fp1", "homelab", nil, "alice", ""); err != nil {
		t.Fatalf("SetClaim: %v", err)
	}

	// Alert disappears — genuine resolution, no re-fire follows.
	rec.processAlerts(ctx, noAlerts())

	// Claim still active — delay not elapsed yet.
	c, _ := rec.store.GetActiveClaim("fp1", "homelab")
	if c == nil {
		t.Fatal("claim should still be active before claimReleaseDelay elapses")
	}

	// Wait for the delayed goroutine to fire and release.
	time.Sleep(5 * rec.claimReleaseDelay)

	c, _ = rec.store.GetActiveClaim("fp1", "homelab")
	if c != nil {
		t.Error("claim should be released after genuine resolution + delay")
	}
}

func TestFetchCluster_InjectsReceiverLabel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v2/alerts" {
			http.NotFound(w, r)
			return
		}
		alerts := []alertmanager.GettableAlert{
			{
				Fingerprint: "abc123",
				Status:      alertmanager.GettableAlertStatus{State: "active"},
				Labels:      map[string]string{"alertname": "TestAlert"},
				Annotations: map[string]string{},
				StartsAt:    time.Now().UTC(),
				EndsAt:      time.Now().UTC(),
				UpdatedAt:   time.Now().UTC(),
				Receivers:   []alertmanager.AMReceiver{{Name: "email-notifications"}},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(alerts)
	}))
	defer srv.Close()

	rec, _ := newTestRecorder(t)
	cl := &cluster.Cluster{
		Name:                "test",
		AlertmanagerURL:     srv.URL,
		AlertmanagerLinkURL: srv.URL,
		Client:              alertmanager.NewClient(srv.URL),
	}

	enriched, err := rec.fetchCluster(context.Background(), cl)
	if err != nil {
		t.Fatalf("fetchCluster: %v", err)
	}
	if len(enriched) != 1 {
		t.Fatalf("expected 1 alert, got %d", len(enriched))
	}
	if got := enriched[0].Labels["@receiver"]; got != "email-notifications" {
		t.Errorf("Labels[@receiver] = %q, want %q", got, "email-notifications")
	}
}

func TestFetchCluster_NoReceiverLabelWhenReceiversEmpty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v2/alerts" {
			http.NotFound(w, r)
			return
		}
		alerts := []alertmanager.GettableAlert{
			{
				Fingerprint: "abc123",
				Status:      alertmanager.GettableAlertStatus{State: "active"},
				Labels:      map[string]string{"alertname": "TestAlert"},
				Annotations: map[string]string{},
				StartsAt:    time.Now().UTC(),
				EndsAt:      time.Now().UTC(),
				UpdatedAt:   time.Now().UTC(),
				Receivers:   []alertmanager.AMReceiver{},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(alerts)
	}))
	defer srv.Close()

	rec, _ := newTestRecorder(t)
	cl := &cluster.Cluster{
		Name:                "test",
		AlertmanagerURL:     srv.URL,
		AlertmanagerLinkURL: srv.URL,
		Client:              alertmanager.NewClient(srv.URL),
	}

	enriched, err := rec.fetchCluster(context.Background(), cl)
	if err != nil {
		t.Fatalf("fetchCluster: %v", err)
	}
	if len(enriched) != 1 {
		t.Fatalf("expected 1 alert, got %d", len(enriched))
	}
	if _, ok := enriched[0].Labels["@receiver"]; ok {
		t.Error("@receiver must not be present when receivers list is empty")
	}
}

// TestRecorder_ClaimNotReleasedOnGracePeriodRefire verifies that a claim is
// NOT released when the alert re-fires within the grace period (transient miss).
func TestRecorder_ClaimNotReleasedOnGracePeriodRefire(t *testing.T) {
	rec, _ := newTestRecorder(t)
	ctx := context.Background()

	rec.processAlerts(ctx, alert("fp1", "active"))
	if _, err := rec.store.SetClaim("fp1", "homelab", nil, "alice", ""); err != nil {
		t.Fatalf("SetClaim: %v", err)
	}

	// Alert disappears for one poll (transient miss).
	rec.processAlerts(ctx, noAlerts())

	// Alert comes back immediately — grace period deletes the resolved row.
	rec.processAlerts(ctx, alert("fp1", "active"))

	// Wait past the claim release delay; goroutine must have checked and skipped.
	time.Sleep(5 * rec.claimReleaseDelay)

	c, _ := rec.store.GetActiveClaim("fp1", "homelab")
	if c == nil {
		t.Error("claim must survive a grace-period re-fire")
	}
}

// TestRecorder_ClaimNotReleasedOnLateRefire is a regression test for the bug
// where a claim was released after genuine resolution (claimReleaseDelay elapsed)
// but the alert re-fired *after* the grace period — e.g. 5 minutes later. The
// delayed goroutine must see the new firing row and skip the release.
func TestRecorder_ClaimNotReleasedOnLateRefire(t *testing.T) {
	rec, _ := newTestRecorder(t)
	ctx := context.Background()

	rec.processAlerts(ctx, alert("fp1", "active"))
	if _, err := rec.store.SetClaim("fp1", "homelab", nil, "alice", ""); err != nil {
		t.Fatalf("SetClaim: %v", err)
	}

	// Alert resolves — goroutine starts with claimReleaseDelay (10ms in tests).
	rec.processAlerts(ctx, noAlerts())

	// Simulate a late re-fire: backdate the resolved row past the 60s grace period
	// so the next processAlerts inserts a genuine new firing row instead of
	// triggering the grace-period delete path.
	if _, err := rec.store.db.ExecContext(ctx,
		`UPDATE alert_events SET recorded_at = ? WHERE status = 'resolved' AND fingerprint = 'fp1'`,
		time.Now().UTC().Add(-61*time.Second),
	); err != nil {
		t.Fatalf("backdate resolved row: %v", err)
	}

	// Alert re-fires after grace period — a real new firing event is recorded.
	rec.processAlerts(ctx, alert("fp1", "active"))

	// Wait past the claim release delay; goroutine must detect the re-fire and skip.
	time.Sleep(5 * rec.claimReleaseDelay)

	c, _ := rec.store.GetActiveClaim("fp1", "homelab")
	if c == nil {
		t.Error("claim must survive a late re-fire (alert resolved then came back after grace period)")
	}
}

// TestRecorder_Poll_InstrumentsMetrics drives a full poll() across one healthy
// and one failing cluster, verifying poll cycle/error counters and the
// scrape-time up-state derived from them (Critical: Collect() must never call
// upstream itself — this is why the state is cached here instead).
func TestRecorder_Poll_InstrumentsMetrics(t *testing.T) {
	healthy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/alerts":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]alertmanager.GettableAlert{
				{
					Fingerprint: "fp1",
					Status:      alertmanager.GettableAlertStatus{State: "active"},
					Labels:      map[string]string{"alertname": "TestAlert"},
					Annotations: map[string]string{},
					StartsAt:    time.Now().UTC(),
				},
			})
		case "/api/v2/silences":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]alertmanager.GettableSilence{})
		default:
			http.NotFound(w, r)
		}
	}))
	defer healthy.Close()

	failing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer failing.Close()

	rec, _ := newTestRecorder(t)
	rec.registry = cluster.NewRegistry([]config.ClusterConfig{
		{Name: "good", AlertmanagerURL: healthy.URL, AlertmanagerLinkURL: healthy.URL},
		{Name: "bad", AlertmanagerURL: failing.URL, AlertmanagerLinkURL: failing.URL},
	})

	rec.poll(context.Background())

	if got := testutil.ToFloat64(rec.metrics.PollCyclesTotal.WithLabelValues("good")); got != 1 {
		t.Errorf("PollCyclesTotal[good] = %v, want 1", got)
	}
	if got := testutil.ToFloat64(rec.metrics.PollCyclesTotal.WithLabelValues("bad")); got != 1 {
		t.Errorf("PollCyclesTotal[bad] = %v, want 1", got)
	}
	if got := testutil.ToFloat64(rec.metrics.PollErrorsTotal.WithLabelValues("bad", "alerts")); got != 1 {
		t.Errorf("PollErrorsTotal[bad,alerts] = %v, want 1", got)
	}
	if got := testutil.ToFloat64(rec.metrics.AlertEventsTotal.WithLabelValues("good", models.EventStatusFiring)); got != 1 {
		t.Errorf("AlertEventsTotal[good,firing] = %v, want 1", got)
	}

	up := rec.ClusterUpStates()
	if !up["good"] {
		t.Error("ClusterUpStates()[good] = false, want true")
	}
	if up["bad"] {
		t.Error("ClusterUpStates()[bad] = true, want false")
	}

	if n := testutil.CollectAndCount(rec.metrics.PollDurationSeconds); n != 1 {
		t.Errorf("PollDurationSeconds series count = %d, want 1", n)
	}
	if n := testutil.CollectAndCount(rec.metrics.ClusterFetchDurationSeconds); n != 2 {
		t.Errorf("ClusterFetchDurationSeconds series count = %d, want 2 (one per cluster)", n)
	}
}

// TestRecorder_Poll_IdempotentPollDoesNotDoubleCountEvents verifies that
// polling the same unchanged alert twice only counts one lifecycle event —
// RecordStatusChange itself is idempotent, so the second poll must not
// increment jarvis_alert_events_total again.
func TestRecorder_Poll_IdempotentPollDoesNotDoubleCountEvents(t *testing.T) {
	rec, _ := newTestRecorder(t)
	ctx := context.Background()

	alerts := []models.EnrichedAlert{makeEnrichedAlert("fp1", "active", "homelab")}
	rec.processAlerts(ctx, alerts)
	rec.processAlerts(ctx, alerts)

	if got := testutil.ToFloat64(rec.metrics.AlertEventsTotal.WithLabelValues("homelab", models.EventStatusFiring)); got != 1 {
		t.Errorf("AlertEventsTotal[homelab,firing] = %v, want 1 (second identical poll must not double-count)", got)
	}
}
