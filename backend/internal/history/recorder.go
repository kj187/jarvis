package history

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/kj187/jarvis/backend/internal/alertmanager"
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
	triggerCh  chan struct{}

	// prevSnapshot holds the fingerprints from the last poll for diff computation.
	prevMu            sync.Mutex
	prevSnapshot      map[string]string           // fingerprint → status
	prevSilenceInfo   map[string]silenceInfoEntry // silenceID → {state, cluster, comment}
	prevAlertSilences map[string][]string         // fingerprint → []silenceID

	// claimReleaseDelay is how long to wait after detecting a resolution before
	// releasing claims. Must exceed the 60s grace period so grace-period re-fires
	// can cancel the release before it runs.
	claimReleaseDelay time.Duration
}

type silenceInfoEntry struct {
	state       string
	clusterName string
	comment     string
	createdBy   string
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
		registry:          registry,
		alertStore:        alertStore,
		store:             store,
		hub:               hub,
		interval:          interval,
		logger:            logger,
		triggerCh:         make(chan struct{}, 1),
		prevSnapshot:      make(map[string]string),
		prevSilenceInfo:   make(map[string]silenceInfoEntry),
		prevAlertSilences: make(map[string][]string),
		claimReleaseDelay: 65 * time.Second,
	}
}

// Trigger signals the recorder to run an immediate poll.
// Non-blocking: if a trigger is already queued, this is a no-op.
func (r *Recorder) Trigger() {
	select {
	case r.triggerCh <- struct{}{}:
	default:
	}
}

// Start begins the polling loop. It polls immediately and then at the
// configured interval. The loop stops when ctx is cancelled.
func (r *Recorder) Start(ctx context.Context) {
	if resolved, err := r.store.GetRecentResolved(7 * 24 * time.Hour); err == nil {
		r.logger.Info("seeding resolved alerts from db", "count", len(resolved))
		r.alertStore.SeedResolved(resolved)
	} else {
		r.logger.Warn("seed resolved alerts from db failed", "err", err)
	}
	r.poll(ctx)
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.poll(ctx)
		case <-r.triggerCh:
			r.poll(ctx)
		}
	}
}

// poll fetches alerts from all clusters, persists lifecycle events, and
// broadcasts the updated alert list.
func (r *Recorder) poll(ctx context.Context) {
	clusters := r.registry.All()

	type clusterResult struct {
		alerts   []models.EnrichedAlert
		silences []alertmanager.GettableSilence
		name     string
		err      error
	}
	results := make([]clusterResult, len(clusters))
	var wg sync.WaitGroup
	for i, cl := range clusters {
		wg.Add(1)
		go func(idx int, cl *cluster.Cluster) {
			defer wg.Done()
			alerts, err := r.fetchCluster(ctx, cl)
			if err != nil {
				results[idx] = clusterResult{name: cl.Name, err: err}
				return
			}
			silences, serr := cl.Client.GetSilences(ctx)
			if serr != nil {
				r.logger.Warn("fetch silences failed", "cluster", cl.Name, "err", serr)
			}
			results[idx] = clusterResult{alerts: alerts, silences: silences, name: cl.Name}
		}(i, cl)
	}
	wg.Wait()

	var allAlerts []models.EnrichedAlert
	currSilenceInfo := make(map[string]silenceInfoEntry)
	for _, res := range results {
		if res.err != nil {
			r.logger.Error("poll cluster failed", "cluster", res.name, "err", res.err)
			continue
		}
		allAlerts = append(allAlerts, res.alerts...)
		for _, s := range res.silences {
			currSilenceInfo[s.ID] = silenceInfoEntry{
				state:       s.Status.State,
				clusterName: res.name,
				comment:     s.Comment,
				createdBy:   s.CreatedBy,
			}
		}
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

	// Build current alert→silences mapping for next poll's expiry detection.
	currAlertSilences := make(map[string][]string, len(allAlerts))
	for _, a := range allAlerts {
		if len(a.Status.SilencedBy) > 0 {
			currAlertSilences[a.Fingerprint] = a.Status.SilencedBy
		}
	}

	// Detect silence expiry: collect (fingerprint, silenceID, info) tuples to record.
	expiredEntries := r.collectExpiredSilences(currSilenceInfo, currAlertSilences)

	// Detect new external silences (first seen in curr, not in prev).
	newSilenceEntries := r.collectNewExternalSilences(currSilenceInfo, currAlertSilences)

	r.prevSnapshot = curr
	r.prevSilenceInfo = currSilenceInfo
	r.prevAlertSilences = currAlertSilences
	r.prevMu.Unlock()

	// Record new external silence "created" events (only when not already tracked by Jarvis).
	for _, e := range newSilenceEntries {
		exists, err := r.store.HasSilenceEventsForSilenceID(e.silenceID)
		if err != nil {
			r.logger.Error("check silence events for silence_id", "silence", e.silenceID, "err", err)
			continue
		}
		if exists {
			continue
		}
		performer := e.info.createdBy
		if performer == "" {
			performer = "system"
		}
		if _, err := r.store.RecordSilenceEvent(e.fingerprint, e.silenceID, e.info.clusterName, "created", performer, e.info.comment); err != nil {
			r.logger.Error("record silence created event", "fp", e.fingerprint, "silence", e.silenceID, "err", err)
		}
	}

	// Record silence expiry events outside the lock.
	for _, e := range expiredEntries {
		performer := e.info.createdBy
		if performer == "" {
			performer = "system"
		}
		if _, err := r.store.RecordSilenceEvent(e.fingerprint, e.silenceID, e.info.clusterName, "expired", performer, e.info.comment); err != nil {
			r.logger.Error("record silence expired event", "fp", e.fingerprint, "silence", e.silenceID, "err", err)
		}
	}

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

		if _, err := r.store.RecordStatusChange(a.Fingerprint, a.ClusterName, a.AlertmanagerURL,
			eventStatus, a.StartsAt, a.Annotations); err != nil {
			r.logger.Error("record status change", "fp", a.Fingerprint, "err", err)
		}
	}

	// Resolve missing alerts.
	if len(resolvedFPs) > 0 {
		for _, fp := range resolvedFPs {
			if err := r.store.RecordResolved(fp, now); err != nil {
				r.logger.Error("record resolved", "fp", fp, "err", err)
			}
		}
		for _, fp := range resolvedFPs {
			go func(fp string) {
				select {
				case <-ctx.Done():
					return
				case <-time.After(r.claimReleaseDelay):
				}
				still, err := r.store.IsStillResolved(fp)
				if err != nil {
					r.logger.Error("check still resolved for claim release", "fp", fp, "err", err)
					return
				}
				if !still {
					return
				}
				if err := r.store.ReleaseClaimsForResolved([]string{fp}); err != nil {
					r.logger.Error("delayed release claims for resolved", "fp", fp, "err", err)
				}
			}(fp)
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

	// Broadcast via WebSocket — use Get() to include resolved buffer.
	payload := map[string]interface{}{"alerts": r.alertStore.Get()}
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

		labels := make(map[string]string, len(a.Labels)+1)
		for k, v := range a.Labels {
			labels[k] = v
		}
		if len(a.Receivers) > 0 {
			labels["@receiver"] = a.Receivers[0].Name
		}

		enriched = append(enriched, models.EnrichedAlert{
			Fingerprint: a.Fingerprint,
			Status: models.AlertStatus{
				InhibitedBy: a.Status.InhibitedBy,
				SilencedBy:  a.Status.SilencedBy,
				State:       a.Status.State,
			},
			Labels:          labels,
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

type expiredEntry = silenceEntry

type silenceEntry struct {
	fingerprint string
	silenceID   string
	info        silenceInfoEntry
}

// collectNewExternalSilences returns entries for silences that appeared for the
// first time in this poll (not in prevSilenceInfo). One entry per affected alert
// fingerprint. The caller deduplicates against the DB to skip silences already
// tracked by the Jarvis API.
func (r *Recorder) collectNewExternalSilences(
	currSilenceInfo map[string]silenceInfoEntry,
	currAlertSilences map[string][]string,
) []silenceEntry {
	var entries []silenceEntry
	for silenceID, info := range currSilenceInfo {
		if _, existed := r.prevSilenceInfo[silenceID]; existed {
			continue
		}
		for fp, sids := range currAlertSilences {
			for _, sid := range sids {
				if sid == silenceID {
					entries = append(entries, silenceEntry{fp, silenceID, info})
					break
				}
			}
		}
	}
	return entries
}

// collectExpiredSilences returns entries for silences that truly expired — i.e.
// the old silence is gone/expired AND the alert is no longer silenced at all.
// If AM replaced the silence with a new ID (edit), the alert stays silenced and
// we skip it to avoid spurious "Silence expired" history entries.
func (r *Recorder) collectExpiredSilences(
	currSilenceInfo map[string]silenceInfoEntry,
	currAlertSilences map[string][]string,
) []expiredEntry {
	var entries []expiredEntry
	for silenceID, prev := range r.prevSilenceInfo {
		if prev.state == "expired" {
			continue
		}
		curr, exists := currSilenceInfo[silenceID]
		if !exists || curr.state == "expired" {
			info := prev
			if exists {
				info = curr
			}
			for fp, sids := range r.prevAlertSilences {
				for _, sid := range sids {
					if sid == silenceID {
						if _, stillSilenced := currAlertSilences[fp]; !stillSilenced {
							entries = append(entries, expiredEntry{fp, silenceID, info})
						}
						break
					}
				}
			}
		}
	}
	return entries
}
