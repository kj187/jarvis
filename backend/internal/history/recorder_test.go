package history

import (
	"context"
	"log/slog"
	"testing"
	"time"

	idb "github.com/kj187/jarvis/backend/internal/db"
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
	db, err := idb.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := idb.Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	hub := &mockHub{}
	store := NewStore(db)
	alertStore := &AlertStore{}
	rec := &Recorder{
		alertStore:   alertStore,
		store:        store,
		hub:          hub,
		interval:     time.Minute,
		logger:       slog.Default(),
		prevSnapshot: make(map[string]string),
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
	if events[0].EndsAt == nil {
		t.Error("expected ends_at to be set after resolve")
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

// processAlerts is a helper that runs the core recorder logic without needing
// a real cluster registry.
func (r *Recorder) processAlerts(ctx context.Context, allAlerts []models.EnrichedAlert) {
	r.prevMu.Lock()
	prev := r.prevSnapshot
	curr := make(map[string]string, len(allAlerts))
	for _, a := range allAlerts {
		curr[a.Fingerprint] = a.Status.State
	}

	var resolvedFPs []string
	for fp, prevState := range prev {
		if _, stillActive := curr[fp]; !stillActive && prevState != "resolved" {
			resolvedFPs = append(resolvedFPs, fp)
		}
	}
	r.prevSnapshot = curr
	r.prevMu.Unlock()

	now := time.Now().UTC()
	for i := range allAlerts {
		a := &allAlerts[i]
		if err := r.store.UpsertFingerprint(a.Fingerprint, a.Labels["alertname"], a.ClusterName, a.Labels); err != nil {
			continue
		}
		eventStatus := models.EventStatusFiring
		switch a.Status.State {
		case "suppressed":
			eventStatus = models.EventStatusSuppressed
		case "active", "unprocessed":
			if prev[a.Fingerprint] == "suppressed" {
				eventStatus = models.EventStatusExpired
			}
		}
		r.store.GetOrCreateActiveEvent(a.Fingerprint, a.ClusterName, a.AlertmanagerURL, eventStatus, a.StartsAt, a.Annotations) //nolint:errcheck
	}

	if len(resolvedFPs) > 0 {
		r.store.ResolveEvents(resolvedFPs, now)       //nolint:errcheck
		r.store.ReleaseClaimsForResolved(resolvedFPs) //nolint:errcheck
		for _, fp := range resolvedFPs {
			r.alertStore.MarkResolved(fp)
		}
	}

	for i := range allAlerts {
		claim, _ := r.store.GetActiveClaim(allAlerts[i].Fingerprint)
		allAlerts[i].ActiveClaim = claim
	}

	r.alertStore.Set(allAlerts)
	r.hub.BroadcastJSON(models.WSTypeAlertsUpdate, map[string]interface{}{"alerts": allAlerts})
}
