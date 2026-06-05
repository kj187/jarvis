package history

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/models"
)

// broadcaster is the minimal interface the Recorder needs from the WS hub.
type broadcaster interface {
	BroadcastJSON(eventType string, payload interface{})
}

// Recorder polls all Alertmanager clusters and persists alert lifecycle events.
type Recorder struct {
	registry   *cluster.Registry
	alertStore *AlertStore
	store      *Store
	hub        broadcaster
	interval   time.Duration
	logger     *slog.Logger

	// prevSnapshot holds the fingerprints from the last poll for diff computation.
	prevMu       sync.Mutex
	prevSnapshot map[string]string // fingerprint → status
}

// NewRecorder creates a new Recorder.
func NewRecorder(
	registry *cluster.Registry,
	alertStore *AlertStore,
	store *Store,
	hub broadcaster,
	interval time.Duration,
	logger *slog.Logger,
) *Recorder {
	return &Recorder{
		registry:     registry,
		alertStore:   alertStore,
		store:        store,
		hub:          hub,
		interval:     interval,
		logger:       logger,
		prevSnapshot: make(map[string]string),
	}
}

// Start begins the polling loop. It polls immediately and then at the
// configured interval. The loop stops when ctx is cancelled.
func (r *Recorder) Start(ctx context.Context) {
	r.poll(ctx)
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.poll(ctx)
		}
	}
}

// poll fetches alerts from all clusters, persists lifecycle events, and
// broadcasts the updated alert list.
func (r *Recorder) poll(ctx context.Context) {
	clusters := r.registry.All()

	type clusterResult struct {
		alerts []models.EnrichedAlert
		err    error
	}
	results := make([]clusterResult, len(clusters))
	var wg sync.WaitGroup
	for i, cl := range clusters {
		wg.Add(1)
		go func(idx int, cl *cluster.Cluster) {
			defer wg.Done()
			alerts, err := r.fetchCluster(ctx, cl)
			results[idx] = clusterResult{alerts: alerts, err: err}
		}(i, cl)
	}
	wg.Wait()

	var allAlerts []models.EnrichedAlert
	for i, res := range results {
		if res.err != nil {
			r.logger.Error("poll cluster failed", "cluster", clusters[i].Name, "err", res.err)
			continue
		}
		allAlerts = append(allAlerts, res.alerts...)
	}

	// Compute diff against previous snapshot.
	r.prevMu.Lock()
	prev := r.prevSnapshot
	curr := make(map[string]string, len(allAlerts))
	for _, a := range allAlerts {
		curr[a.Fingerprint] = a.Status.State
	}

	// Resolved = fingerprints in prev but not in curr (and not already resolved).
	var resolvedFPs []string
	for fp, prevState := range prev {
		if _, stillActive := curr[fp]; !stillActive && prevState != "resolved" {
			resolvedFPs = append(resolvedFPs, fp)
		}
	}
	r.prevSnapshot = curr
	r.prevMu.Unlock()

	// Persist events.
	now := time.Now().UTC()
	for i := range allAlerts {
		a := &allAlerts[i]
		if err := r.store.UpsertFingerprint(a.Fingerprint, a.Labels["alertname"], a.ClusterName, a.Labels); err != nil {
			r.logger.Error("upsert fingerprint", "fp", a.Fingerprint, "err", err)
			continue
		}

		// Map AM status to event status.
		eventStatus := models.EventStatusFiring
		switch a.Status.State {
		case "suppressed":
			eventStatus = models.EventStatusSuppressed
		case "active", "unprocessed":
			// Check if previously suppressed → expired transition.
			if prev[a.Fingerprint] == "suppressed" {
				eventStatus = models.EventStatusExpired
			} else {
				eventStatus = models.EventStatusFiring
			}
		}

		if _, err := r.store.GetOrCreateActiveEvent(a.Fingerprint, a.ClusterName, a.AlertmanagerURL,
			eventStatus, a.StartsAt, a.Annotations); err != nil {
			r.logger.Error("get or create event", "fp", a.Fingerprint, "err", err)
		}
	}

	// Resolve missing alerts.
	if len(resolvedFPs) > 0 {
		if err := r.store.ResolveEvents(resolvedFPs, now); err != nil {
			r.logger.Error("resolve events", "err", err)
		}
		if err := r.store.ReleaseClaimsForResolved(resolvedFPs); err != nil {
			r.logger.Error("release claims for resolved", "err", err)
		}

		// Keep resolved alerts in-memory for 20 minutes (greyed out), then remove.
		for _, fp := range resolvedFPs {
			r.alertStore.MarkResolved(fp)
			go func(fp string) {
				select {
				case <-ctx.Done():
				case <-time.After(20 * time.Minute):
					r.alertStore.RemoveByFingerprint(fp)
				}
			}(fp)
		}
	}

	// Attach active claims to all alerts.
	for i := range allAlerts {
		claim, err := r.store.GetActiveClaim(allAlerts[i].Fingerprint)
		if err != nil {
			r.logger.Error("get active claim", "fp", allAlerts[i].Fingerprint, "err", err)
			continue
		}
		allAlerts[i].ActiveClaim = claim
	}

	r.alertStore.Set(allAlerts)

	// Broadcast via WebSocket.
	payload := map[string]interface{}{"alerts": allAlerts}
	r.hub.BroadcastJSON(models.WSTypeAlertsUpdate, payload)
}

// fetchCluster fetches and enriches alerts for a single cluster.
func (r *Recorder) fetchCluster(ctx context.Context, cl *cluster.Cluster) ([]models.EnrichedAlert, error) {
	rawAlerts, err := cl.Client.GetAlerts(ctx)
	if err != nil {
		return nil, err
	}

	enriched := make([]models.EnrichedAlert, 0, len(rawAlerts))
	for _, a := range rawAlerts {
		receivers := make([]models.Receiver, len(a.Receivers))
		for i, r := range a.Receivers {
			receivers[i] = models.Receiver{Name: r.Name}
		}
		enriched = append(enriched, models.EnrichedAlert{
			Fingerprint: a.Fingerprint,
			Status: models.AlertStatus{
				InhibitedBy: a.Status.InhibitedBy,
				SilencedBy:  a.Status.SilencedBy,
				State:       a.Status.State,
			},
			Labels:          a.Labels,
			Annotations:     a.Annotations,
			StartsAt:        a.StartsAt,
			EndsAt:          a.EndsAt,
			UpdatedAt:       a.UpdatedAt,
			GeneratorURL:    a.GeneratorURL,
			Receivers:       receivers,
			ClusterName:     cl.Name,
			AlertmanagerURL: cl.AlertmanagerLinkURL,
		})
	}
	return enriched, nil
}

// buildWSPayload marshals a typed WS event payload (helper used in tests).
func buildWSPayload(eventType string, payload interface{}) ([]byte, error) {
	p, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return json.Marshal(models.WSEvent{Type: eventType, Payload: p})
}

var _ = buildWSPayload // suppress unused warning in non-test builds
