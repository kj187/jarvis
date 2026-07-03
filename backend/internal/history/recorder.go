package history

import (
	"context"
	"encoding/json"
	"hash/fnv"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/kj187/jarvis/backend/internal/alertmanager"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/metrics"
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
	metrics    *metrics.Metrics

	// prevSnapshot holds the alert instance (fingerprint+cluster) from the last poll for diff computation.
	prevMu            sync.Mutex
	prevSnapshot      map[string]string           // fingerprint+cluster → status
	prevSilenceInfo   map[string]silenceInfoEntry // cluster+silenceID → {state, cluster, comment}
	prevAlertSilences map[string][]string         // fingerprint+cluster → []cluster+silenceID

	// clusterUpMu guards clusterUp, the last-poll-success flag per cluster.
	// Read at scrape time by the metrics collector — never issues an upstream
	// HTTP call itself, so a slow/unreachable Alertmanager cannot stall a scrape.
	clusterUpMu sync.Mutex
	clusterUp   map[string]bool

	// claimReleaseDelay is how long to wait after detecting a resolution before
	// releasing claims. Must exceed the 60s grace period so grace-period re-fires
	// can cancel the release before it runs.
	claimReleaseDelay time.Duration

	// broadcastMu guards the dedup state for the alerts-update WebSocket broadcast.
	broadcastMu       sync.Mutex
	lastBroadcastHash uint64
	hasBroadcast      bool
}

type silenceInfoEntry struct {
	state       string
	clusterName string
	comment     string
	createdBy   string
}

type resolvedAlert struct {
	fingerprint string
	clusterName string
}

func recorderAlertKey(fingerprint, clusterName string) string {
	return fingerprint + "\x1f" + clusterName
}

func splitRecorderAlertKey(key string) (fingerprint, clusterName string) {
	parts := strings.SplitN(key, "\x1f", 2)
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return key, ""
}

func recorderSilenceKey(clusterName, silenceID string) string {
	return clusterName + "\x1f" + silenceID
}

func splitRecorderSilenceKey(key string) (clusterName, silenceID string) {
	parts := strings.SplitN(key, "\x1f", 2)
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return "", key
}

// NewRecorder creates a new Recorder.
func NewRecorder(
	registry *cluster.Registry,
	alertStore *AlertStore,
	store *Store,
	hub broadcaster,
	interval time.Duration,
	logger *slog.Logger,
	m *metrics.Metrics,
) *Recorder {
	return &Recorder{
		registry:          registry,
		alertStore:        alertStore,
		store:             store,
		hub:               hub,
		interval:          interval,
		logger:            logger,
		metrics:           m,
		triggerCh:         make(chan struct{}, 1),
		prevSnapshot:      make(map[string]string),
		prevSilenceInfo:   make(map[string]silenceInfoEntry),
		prevAlertSilences: make(map[string][]string),
		clusterUp:         make(map[string]bool),
		claimReleaseDelay: 20 * time.Minute,
	}
}

// ClusterUpStates returns a copy of the last-poll-success flag per cluster.
// Used by the metrics collector at scrape time — reads cached state only,
// never performs an upstream HTTP call.
func (r *Recorder) ClusterUpStates() map[string]bool {
	r.clusterUpMu.Lock()
	defer r.clusterUpMu.Unlock()
	out := make(map[string]bool, len(r.clusterUp))
	for k, v := range r.clusterUp {
		out[k] = v
	}
	return out
}

func (r *Recorder) setClusterUp(clusterName string, up bool) {
	r.clusterUpMu.Lock()
	r.clusterUp[clusterName] = up
	r.clusterUpMu.Unlock()
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
	start := time.Now()
	defer func() {
		if r.metrics != nil {
			r.metrics.PollDurationSeconds.Observe(time.Since(start).Seconds())
		}
	}()

	clusters := r.registry.All()

	type clusterResult struct {
		alerts      []models.EnrichedAlert
		silences    []alertmanager.GettableSilence
		name        string
		err         error
		silencesErr error
	}
	results := make([]clusterResult, len(clusters))
	var wg sync.WaitGroup
	for i, cl := range clusters {
		wg.Add(1)
		go func(idx int, cl *cluster.Cluster) {
			defer wg.Done()
			if r.metrics != nil {
				r.metrics.PollCyclesTotal.WithLabelValues(cl.Name).Inc()
			}
			alerts, err := r.fetchCluster(ctx, cl)
			if err != nil {
				results[idx] = clusterResult{name: cl.Name, err: err}
				return
			}
			silences, serr := cl.Client.GetSilences(ctx)
			if serr != nil {
				r.logger.Warn("fetch silences failed", "cluster", cl.Name, "err", serr)
			}
			results[idx] = clusterResult{alerts: alerts, silences: silences, name: cl.Name, silencesErr: serr}
		}(i, cl)
	}
	wg.Wait()

	var allAlerts []models.EnrichedAlert
	currSilenceInfo := make(map[string]silenceInfoEntry)
	for _, res := range results {
		if res.err != nil {
			r.logger.Error("poll cluster failed", "cluster", res.name, "err", res.err)
			r.setClusterUp(res.name, false)
			if r.metrics != nil {
				r.metrics.PollErrorsTotal.WithLabelValues(res.name, "alerts").Inc()
			}
			continue
		}
		r.setClusterUp(res.name, true)
		if res.silencesErr != nil && r.metrics != nil {
			r.metrics.PollErrorsTotal.WithLabelValues(res.name, "silences").Inc()
		}
		allAlerts = append(allAlerts, res.alerts...)
		for _, s := range res.silences {
			currSilenceInfo[recorderSilenceKey(res.name, s.ID)] = silenceInfoEntry{
				state:       s.Status.State,
				clusterName: res.name,
				comment:     s.Comment,
				createdBy:   s.CreatedBy,
			}
		}
	}

	r.applyPollResults(ctx, allAlerts, currSilenceInfo)
}

// applyPollResults persists lifecycle events for the given alert snapshot,
// detects silence creation/expiry, updates the in-memory store, and broadcasts
// the result. It contains the core recorder logic, decoupled from the cluster
// fetch so it can be driven directly by tests. currSilenceInfo maps
// cluster+silenceID to current state; pass nil when there are no silences.
func (r *Recorder) applyPollResults(
	ctx context.Context,
	allAlerts []models.EnrichedAlert,
	currSilenceInfo map[string]silenceInfoEntry,
) {
	if currSilenceInfo == nil {
		currSilenceInfo = map[string]silenceInfoEntry{}
	}

	// Compute diff against previous snapshot.
	r.prevMu.Lock()
	prev := r.prevSnapshot
	curr := make(map[string]string, len(allAlerts))
	for _, a := range allAlerts {
		curr[recorderAlertKey(a.Fingerprint, a.ClusterName)] = a.Status.State
	}

	// Resolved = alerts (fingerprint+cluster) in prev but not in curr.
	var resolvedAlerts []resolvedAlert
	for key, prevState := range prev {
		if _, stillActive := curr[key]; !stillActive && prevState != "resolved" {
			fp, clusterName := splitRecorderAlertKey(key)
			resolvedAlerts = append(resolvedAlerts, resolvedAlert{fingerprint: fp, clusterName: clusterName})
		}
	}

	// Build current alert→silences mapping for next poll's expiry detection.
	currAlertSilences := make(map[string][]string, len(allAlerts))
	for _, a := range allAlerts {
		if len(a.Status.SilencedBy) > 0 {
			key := recorderAlertKey(a.Fingerprint, a.ClusterName)
			silenceKeys := make([]string, 0, len(a.Status.SilencedBy))
			for _, silenceID := range a.Status.SilencedBy {
				silenceKeys = append(silenceKeys, recorderSilenceKey(a.ClusterName, silenceID))
			}
			currAlertSilences[key] = silenceKeys
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
		exists, err := r.store.HasSilenceEventsForSilenceIDInCluster(e.silenceID, e.info.clusterName)
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
		alertKey := recorderAlertKey(a.Fingerprint, a.ClusterName)
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
			if prev[alertKey] == "suppressed" {
				eventStatus = models.EventStatusExpired
			} else {
				eventStatus = models.EventStatusFiring
			}
		}

		prevState, hadPrevState := prev[alertKey]
		stateChanged := !hadPrevState || prevState != a.Status.State

		if _, err := r.store.RecordStatusChange(a.Fingerprint, a.ClusterName, a.AlertmanagerURL,
			eventStatus, a.StartsAt, a.Annotations); err != nil {
			r.logger.Error("record status change", "fp", a.Fingerprint, "err", err)
		} else if stateChanged && r.metrics != nil {
			// RecordStatusChange is idempotent (same status → no-op); only count
			// actual lifecycle transitions, matching the DB's own idempotency check.
			r.metrics.AlertEventsTotal.WithLabelValues(eventStatus).Inc()
		}
	}

	// Resolve missing alerts.
	if len(resolvedAlerts) > 0 {
		for _, ra := range resolvedAlerts {
			if err := r.store.RecordResolvedForCluster(ra.fingerprint, ra.clusterName, now); err != nil {
				r.logger.Error("record resolved", "fp", ra.fingerprint, "cluster", ra.clusterName, "err", err)
			} else if r.metrics != nil {
				r.metrics.AlertEventsTotal.WithLabelValues(models.EventStatusResolved).Inc()
			}
		}
		for _, ra := range resolvedAlerts {
			go func(ra resolvedAlert) {
				select {
				case <-ctx.Done():
					return
				case <-time.After(r.claimReleaseDelay):
				}
				still, err := r.store.IsStillResolvedForCluster(ra.fingerprint, ra.clusterName)
				if err != nil {
					r.logger.Error("check still resolved for claim release", "fp", ra.fingerprint, "cluster", ra.clusterName, "err", err)
					return
				}
				if !still {
					return
				}
				if err := r.store.ReleaseClaimsForResolvedInCluster(ra.fingerprint, ra.clusterName); err != nil {
					r.logger.Error("delayed release claims for resolved", "fp", ra.fingerprint, "cluster", ra.clusterName, "err", err)
				}
			}(ra)
		}

		// Keep resolved alerts in-memory for 20 minutes (greyed out), then remove.
		for _, ra := range resolvedAlerts {
			r.alertStore.MarkResolvedForCluster(ra.fingerprint, ra.clusterName)
			go func(ra resolvedAlert) {
				select {
				case <-ctx.Done():
				case <-time.After(20 * time.Minute):
					r.alertStore.RemoveByFingerprintForCluster(ra.fingerprint, ra.clusterName)
				}
			}(ra)
		}
	}

	// Attach active claims to all alerts. A single batched query avoids an N+1
	// pattern (one query per alert) against the single SQLite writer connection.
	activeClaims, err := r.store.GetActiveClaims()
	if err != nil {
		r.logger.Error("get active claims", "err", err)
		activeClaims = nil
	}
	for i := range allAlerts {
		key := ClaimKey{Fingerprint: allAlerts[i].Fingerprint, ClusterName: allAlerts[i].ClusterName}
		if claim, ok := activeClaims[key]; ok {
			allAlerts[i].ActiveClaim = claim
		}
	}

	r.alertStore.Set(allAlerts)

	// Broadcast via WebSocket — use Get() to include resolved buffer.
	r.broadcastAlertsIfChanged()
}

// broadcastAlertsIfChanged pushes the current alert snapshot to all WebSocket
// clients, but skips the push when the snapshot is byte-identical to the one
// broadcast on the previous poll. The frontend loads its initial state via REST
// and relies on WebSocket messages only for *changes*, so suppressing redundant
// identical broadcasts saves an envelope marshal and a fan-out write to every
// client on idle polls — with no visible effect. The comparison can only ever
// yield a false "changed" (e.g. resolved-buffer map ordering), never a false
// "unchanged", so updates are never missed.
func (r *Recorder) broadcastAlertsIfChanged() {
	payload := map[string]interface{}{"alerts": r.alertStore.Get()}
	data, err := json.Marshal(payload)
	if err != nil {
		r.logger.Error("marshal alerts payload", "err", err)
		return
	}

	h := fnv.New64a()
	_, _ = h.Write(data)
	sum := h.Sum64()

	r.broadcastMu.Lock()
	unchanged := r.hasBroadcast && sum == r.lastBroadcastHash
	r.lastBroadcastHash = sum
	r.hasBroadcast = true
	r.broadcastMu.Unlock()

	if unchanged {
		return
	}
	r.hub.BroadcastJSON(models.WSTypeAlertsUpdate, json.RawMessage(data))
}

// fetchCluster fetches and enriches alerts for a single cluster.
func (r *Recorder) fetchCluster(ctx context.Context, cl *cluster.Cluster) ([]models.EnrichedAlert, error) {
	rawAlerts, err := cl.Client.GetAlerts(ctx)
	if err != nil {
		return nil, err
	}
	return enrichAlerts(rawAlerts, cl.Name, cl.AlertmanagerLinkURL), nil
}

// enrichAlerts maps raw Alertmanager alerts to EnrichedAlert, injecting the
// cluster metadata and the synthetic "@receiver" label (comma-separated list of
// receiver names) used for filtering. It is a pure function so it can be unit
// tested and benchmarked without an HTTP round-trip.
//
// The receiver names are gathered in a single pass that builds both the
// Receivers slice and the "@receiver" join string, avoiding a second loop and a
// throwaway slice per alert — this matters when enriching large alert sets.
func enrichAlerts(rawAlerts []alertmanager.GettableAlert, clusterName, alertmanagerLinkURL string) []models.EnrichedAlert {
	enriched := make([]models.EnrichedAlert, 0, len(rawAlerts))
	for i := range rawAlerts {
		a := &rawAlerts[i]

		receivers := make([]models.Receiver, len(a.Receivers))
		var receiverList strings.Builder
		for j, rcv := range a.Receivers {
			receivers[j] = models.Receiver{Name: rcv.Name}
			if j > 0 {
				receiverList.WriteByte(',')
			}
			receiverList.WriteString(rcv.Name)
		}

		labelCount := len(a.Labels)
		if len(a.Receivers) > 0 {
			labelCount++
		}
		labels := make(map[string]string, labelCount)
		for k, v := range a.Labels {
			labels[k] = v
		}
		// Store all receivers as comma-separated list for filtering.
		// This allows filters to match any receiver that handles this alert.
		if len(a.Receivers) > 0 {
			labels["@receiver"] = receiverList.String()
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
			ClusterName:     clusterName,
			AlertmanagerURL: alertmanagerLinkURL,
		})
	}
	return enriched
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
					fingerprint, _ := splitRecorderAlertKey(fp)
					_, rawSilenceID := splitRecorderSilenceKey(silenceID)
					entries = append(entries, silenceEntry{fingerprint, rawSilenceID, info})
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
							fingerprint, _ := splitRecorderAlertKey(fp)
							_, rawSilenceID := splitRecorderSilenceKey(silenceID)
							entries = append(entries, expiredEntry{fingerprint, rawSilenceID, info})
						}
						break
					}
				}
			}
		}
	}
	return entries
}
