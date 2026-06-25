package history

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/alertmanager"
	"github.com/kj187/jarvis/backend/internal/cluster"
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
		prevSnapshot:      make(map[string]string),
		prevSilenceInfo:   make(map[string]silenceInfoEntry),
		prevAlertSilences: make(map[string][]string),
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
