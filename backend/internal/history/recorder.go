package history

import (
	"context"
	"encoding/json"
	"hash/fnv"
	"log/slog"
	"maps"
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

// elector is the minimal leader-election view Recorder needs from
// internal/leader.Elector — kept narrow so history doesn't import
// internal/leader (mirrors internal/retention's narrow store interface).
// Satisfied structurally by *leader.PGElector and *leader.StaticElector.
type elector interface {
	IsLeader() bool
	Subscribe(fn func(isLeader bool))
}

// Recorder polls all Alertmanager clusters and persists alert lifecycle events.
type Recorder struct {
	registry     *cluster.Registry
	alertStore   *AlertStore
	silenceStore *SilenceStore
	store        *Store
	hub          broadcaster
	interval     time.Duration
	logger       *slog.Logger
	triggerCh    chan struct{}
	metrics      *metrics.Metrics

	// prevSnapshot holds the alert instance (fingerprint+cluster) from the last poll for diff computation.
	prevMu            sync.Mutex
	prevSnapshot      map[string]string           // fingerprint+cluster → status
	prevSilenceInfo   map[string]silenceInfoEntry // cluster+silenceID → {state, cluster, comment}
	prevAlertSilences map[string][]string         // fingerprint+cluster → []cluster+silenceID

	// lastGoodAlerts holds each cluster's most recently successfully fetched
	// alert list. poll() reads only within its own single-threaded loop, so
	// no separate mutex is needed. A cluster whose fetch fails reuses this
	// snapshot instead of contributing zero alerts, so a transient AM outage
	// never looks like every one of its alerts resolved (mirrors the
	// silence-snapshot "only update on success" pattern above).
	lastGoodAlerts map[string][]models.EnrichedAlert

	// reconciledClusters tracks which clusters have already run startup
	// reconciliation (reconcileStartupResolves) since this Recorder was
	// created — each cluster runs it exactly once, on its first successful
	// fetch. prevSnapshot is only ever populated in-memory, so after a
	// restart it starts empty regardless of what actually happened in the
	// DB while Jarvis was down; this repairs that gap once at startup
	// instead of relying on the (by-then-empty) poll diff.
	reconciledClusters map[string]bool

	// claimReleaseDelay is how long to wait after detecting a resolution before
	// releasing claims. Must exceed the store's grace period (Store.gracePeriod,
	// set via SetGracePeriod) so grace-period re-fires can cancel the release
	// before it runs — see NewRecorder's doc comment.
	claimReleaseDelay time.Duration

	// broadcastMu guards the dedup state for the alerts-update WebSocket broadcast.
	broadcastMu       sync.Mutex
	lastBroadcastHash uint64
	hasBroadcast      bool

	// elector gates the history-write side effects (tmp/fable/multi-replica.md
	// D3 step 4): RecordStatusChange/RecordResolvedForCluster, occurrence_count,
	// delayed claim-release, reconcileStartupResolves, external-silence event
	// recording. nil means "always leader" (SQLite dialect, and tests that
	// construct a Recorder without one) — the pre-multi-replica behavior.
	elector elector

	// dsn is the raw PostgreSQL connection string, used only to open the
	// dedicated LISTEN connections in runPollLoop (jarvis_trigger) and
	// runFollowerLoop (jarvis_snapshot) — separate from store's pooled *sql.DB,
	// mirroring leader.PGElector's own dedicated-connection pattern. Empty for
	// SQLite, where neither loop ever LISTENs.
	dsn string

	// followerMu guards followerSnapshots, populated only while this pod is a
	// follower (D3): per-cluster alerts/member-up-state/freshness received via
	// PostgreSQL snapshot rows instead of this pod's own poll. nil/empty while
	// leader or on SQLite.
	followerMu        sync.Mutex
	followerSnapshots map[string]followerSnapshotEntry
}

// followerSnapshotEntry is one cluster's most recently consumed snapshot.
type followerSnapshotEntry struct {
	alerts   []models.EnrichedAlert
	memberUp map[string]bool
	takenAt  time.Time
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

// NewRecorder creates a new Recorder. claimReleaseDelay must exceed the
// grace period configured on store (Store.SetGracePeriod) — otherwise the
// delayed claim-release check could run before a grace-period-eligible
// re-fire has had a chance to reopen the resolved event, releasing a claim
// that should have stayed held. Callers derive it accordingly (see
// cmd/jarvis/main.go).
func NewRecorder(
	registry *cluster.Registry,
	alertStore *AlertStore,
	silenceStore *SilenceStore,
	store *Store,
	hub broadcaster,
	interval time.Duration,
	logger *slog.Logger,
	m *metrics.Metrics,
	claimReleaseDelay time.Duration,
	el elector,
	dsn string,
) *Recorder {
	r := &Recorder{
		registry:           registry,
		alertStore:         alertStore,
		silenceStore:       silenceStore,
		store:              store,
		hub:                hub,
		interval:           interval,
		logger:             logger,
		metrics:            m,
		triggerCh:          make(chan struct{}, 1),
		prevSnapshot:       make(map[string]string),
		prevSilenceInfo:    make(map[string]silenceInfoEntry),
		prevAlertSilences:  make(map[string][]string),
		lastGoodAlerts:     make(map[string][]models.EnrichedAlert),
		reconciledClusters: make(map[string]bool),
		claimReleaseDelay:  claimReleaseDelay,
		elector:            el,
		dsn:                dsn,
		followerSnapshots:  make(map[string]followerSnapshotEntry),
	}
	if el != nil {
		el.Subscribe(r.onLeadershipChange)
	}
	return r
}

// IsLeader reports whether this pod currently holds Alertmanager-polling /
// history-write leadership. Always true when no elector was configured
// (SQLite dialect, or a Recorder built directly in tests) — the single-writer
// case has exactly one writer already.
func (r *Recorder) IsLeader() bool {
	return r.elector == nil || r.elector.IsLeader()
}

// onLeadershipChange is registered with the elector (D2/D7 in
// tmp/fable/multi-replica.md: Subscribe, not a single channel, since the pod
// labeler (slice 4) is a second independent consumer). Must not block —
// Subscribe callbacks run sequentially on the elector's own goroutine.
func (r *Recorder) onLeadershipChange(isLeader bool) {
	if r.metrics != nil {
		if isLeader {
			r.metrics.Leader.Set(1)
			// A promoted pod is no longer a follower — its stale-snapshot
			// state (if any) no longer applies.
			r.metrics.SnapshotStale.Set(0)
		} else {
			r.metrics.Leader.Set(0)
		}
	}
	if !isLeader {
		// Also fires once on startup with the not-yet-connected initial state
		// (PGElector.Subscribe/StaticElector.Subscribe both fire immediately —
		// not necessarily a real step-down from prior leadership).
		r.logger.Info("not leader (follower)")
		return
	}
	r.logger.Info("promoted to leader")
	// Poll immediately rather than waiting up to a full interval: the
	// once-per-cluster reconcileStartupResolves guard in poll() only runs
	// while IsLeader() is true, so a newly promoted leader needs a poll to
	// pick it up (D3 item 4: "new leader runs reconcileStartupResolves once").
	r.Trigger()
}

// ClusterUpStates returns the last-poll-success flag per cluster and member
// (cluster name -> member name -> up). Used by the metrics collector at
// scrape time — reads each cluster's cached state only, never performs an
// upstream HTTP call. While this pod is a follower (D3), member up-states
// come from the last consumed snapshot instead of this pod's own (nonexistent)
// poll — every pod still reports cluster health from *some* recent poll.
func (r *Recorder) ClusterUpStates() map[string]map[string]bool {
	if !r.IsLeader() {
		r.followerMu.Lock()
		defer r.followerMu.Unlock()
		out := make(map[string]map[string]bool, len(r.followerSnapshots))
		for name, entry := range r.followerSnapshots {
			out[name] = entry.memberUp
		}
		return out
	}
	out := make(map[string]map[string]bool, len(r.registry.All()))
	for _, cl := range r.registry.All() {
		out[cl.Name] = cl.MemberUpStates()
	}
	return out
}

// Trigger signals the recorder to run an immediate poll.
// Non-blocking: if a trigger is already queued, this is a no-op. A follower
// cannot poll itself (D3 item 7): it forwards the request to the leader via
// pg_notify(jarvis_trigger, ''); the leader's own runPollLoop LISTENs on that
// channel and treats it exactly like a local Trigger() call.
func (r *Recorder) Trigger() {
	if !r.IsLeader() {
		if err := r.store.NotifyTrigger(context.Background()); err != nil {
			r.logger.Error("forward trigger to leader", "err", err)
		}
		return
	}
	r.triggerLocal()
}

// triggerLocal enqueues an immediate poll on this pod's own loop — the
// leader's local path for Trigger(), and also invoked when this pod's
// jarvis_trigger listener (runPollLoop) receives a forwarded trigger from a
// follower.
func (r *Recorder) triggerLocal() {
	select {
	case r.triggerCh <- struct{}{}:
	default:
	}
}

// Start seeds resolved alerts from the DB, then runs the poll loop — for
// SQLite (or a Recorder built without an elector, e.g. most tests), that is
// the only mode there ever is. On PostgreSQL, a mode supervisor instead
// switches this pod between polling (leader) and consuming snapshots
// (follower) on every leadership transition, restarting the active loop each
// time (D3). The loop(s) stop when ctx is cancelled.
func (r *Recorder) Start(ctx context.Context) {
	if resolved, err := r.store.GetRecentResolved(7 * 24 * time.Hour); err == nil {
		r.logger.Info("seeding resolved alerts from db", "count", len(resolved))
		r.alertStore.SeedResolved(resolved)
	} else {
		r.logger.Warn("seed resolved alerts from db failed", "err", err)
	}

	if r.elector == nil || r.dsn == "" {
		r.runPollLoop(ctx)
		return
	}

	var (
		modeMu     sync.Mutex
		cancelMode context.CancelFunc = func() {}
	)
	r.elector.Subscribe(func(isLeader bool) {
		modeMu.Lock()
		defer modeMu.Unlock()
		cancelMode()
		modeCtx, cancel := context.WithCancel(ctx)
		cancelMode = cancel
		if isLeader {
			go r.runPollLoop(modeCtx)
		} else {
			go r.runFollowerLoop(modeCtx)
		}
	})
	<-ctx.Done()
	modeMu.Lock()
	cancelMode()
	modeMu.Unlock()
}

// runPollLoop polls immediately and then at the configured interval, exactly
// as Start did before multi-replica support. On PostgreSQL it additionally
// LISTENs on jarvis_trigger, so a follower's forwarded Trigger() call reaches
// the leader without waiting for the next tick.
func (r *Recorder) runPollLoop(ctx context.Context) {
	if r.dsn != "" {
		go r.listenLoop(ctx, notifyChannelTrigger, r.interval, func(string) { r.triggerLocal() }, nil)
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
			var onDuration cluster.FetchDurationFunc
			if r.metrics != nil {
				r.metrics.PollCyclesTotal.WithLabelValues(cl.Name).Inc()
				onDuration = func(member string, seconds float64) {
					r.metrics.ClusterFetchDurationSeconds.WithLabelValues(cl.Name, member).Observe(seconds)
				}
			}
			alerts, err := cl.FetchAlerts(ctx, onDuration)
			if err != nil {
				results[idx] = clusterResult{name: cl.Name, err: err}
				return
			}
			silences, serr := cl.FetchSilences(ctx, onDuration)
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
			if r.metrics != nil {
				r.metrics.PollErrorsTotal.WithLabelValues(res.name, "alerts").Inc()
			}
			// Reuse the last known-good alert snapshot instead of contributing
			// zero alerts — otherwise the diff below reads every alert of this
			// cluster as resolved on a merely transient fetch failure.
			if stale, ok := r.lastGoodAlerts[res.name]; ok {
				allAlerts = append(allAlerts, stale...)
			}
			continue
		}
		if res.silencesErr != nil && r.metrics != nil {
			r.metrics.PollErrorsTotal.WithLabelValues(res.name, "silences").Inc()
		}
		// Snapshot only on a successful fetch — a transient failure must not
		// blank the cluster's silences; the previous snapshot stays live.
		if res.silencesErr == nil && r.silenceStore != nil {
			r.silenceStore.Set(res.name, res.silences)
		}
		r.lastGoodAlerts[res.name] = res.alerts
		// Only the leader may run startup reconciliation (D3 step 4): a
		// follower leaves reconciledClusters[res.name] false, so the moment
		// this pod is promoted, its next poll (triggered immediately by
		// onLeadershipChange) picks the reconciliation up exactly once.
		if !r.reconciledClusters[res.name] && r.IsLeader() {
			r.reconcileStartupResolves(res.name, res.alerts)
			r.reconciledClusters[res.name] = true
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

	// Persist + notify per-cluster snapshots for followers (D3). Leader-only
	// (this method only ever runs while leader — see runPollLoop) and
	// PostgreSQL-only (r.dsn is empty on SQLite).
	if r.dsn != "" {
		r.persistSnapshots(ctx, clusters)
	}
}

// reconcileStartupResolves resolves alerts that actually went away while
// Jarvis was down. It runs once per cluster, on that cluster's first
// successful fetch since this Recorder was created: prevSnapshot lives only
// in memory, so right after a restart it's empty and the normal poll diff
// in applyPollResults has nothing to compare against — an alert that
// resolved during the downtime keeps a dangling "firing" row forever
// (idempotency then silently swallows its next re-fire, since firing ==
// firing). currentAlerts is the cluster's freshly fetched snapshot.
//
// Known limitation (acceptable): the resolved timestamp recorded here is
// startup time, not the real time the alert resolved during the downtime —
// there is no way to recover that. An approximate resolve is still more
// honest than a permanently stuck "firing" row.
func (r *Recorder) reconcileStartupResolves(clusterName string, currentAlerts []models.EnrichedAlert) {
	open, err := r.store.GetOpenFingerprintsForCluster(clusterName, 7*24*time.Hour)
	if err != nil {
		r.logger.Error("reconcile startup resolves: get open fingerprints", "cluster", clusterName, "err", err)
		return
	}
	if len(open) == 0 {
		return
	}
	current := make(map[string]struct{}, len(currentAlerts))
	for _, a := range currentAlerts {
		current[a.Fingerprint] = struct{}{}
	}
	now := time.Now().UTC()
	for _, fp := range open {
		if _, stillActive := current[fp]; stillActive {
			continue
		}
		if err := r.store.RecordResolvedForCluster(fp, clusterName, now); err != nil {
			r.logger.Error("reconcile startup resolves: record resolved", "fp", fp, "cluster", clusterName, "err", err)
			continue
		}
		r.logger.Info("reconciled stale open alert as resolved on startup", "fp", fp, "cluster", clusterName)
		if r.metrics != nil {
			r.metrics.AlertEventsTotal.WithLabelValues(clusterName, models.EventStatusResolved).Inc()
		}
	}
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

	// The silence snapshot changed when any silence appeared, disappeared, or
	// changed state — clients then refetch /api/v1/silences (cheap, in-memory).
	silencesChanged := !maps.Equal(r.prevSilenceInfo, currSilenceInfo)

	r.prevSnapshot = curr
	r.prevSilenceInfo = currSilenceInfo
	r.prevAlertSilences = currAlertSilences
	r.prevMu.Unlock()

	// External-silence event recording is a leader-only side effect (D3 step
	// 4): a follower must not write silence_events rows.
	if r.IsLeader() {
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
	}

	// Persisting events (UpsertFingerprint + RecordStatusChange +
	// RecordResolvedForCluster) is leader-only (D3 step 4) — a follower still
	// computed the diff above for its own in-memory AlertStore, but must not
	// write history.
	now := time.Now().UTC()
	if r.IsLeader() {
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

			if _, created, err := r.store.RecordStatusChange(a.Fingerprint, a.ClusterName, a.AlertmanagerURL,
				eventStatus, a.StartsAt, a.Annotations); err != nil {
				r.logger.Error("record status change", "fp", a.Fingerprint, "err", err)
			} else if created && r.metrics != nil {
				// Count exactly the events the store persisted — the store owns the
				// idempotency and grace-period decisions, so the metric can't drift.
				r.metrics.AlertEventsTotal.WithLabelValues(a.ClusterName, eventStatus).Inc()
			}
		}

		// Resolve missing alerts.
		if len(resolvedAlerts) > 0 {
			for _, ra := range resolvedAlerts {
				if err := r.store.RecordResolvedForCluster(ra.fingerprint, ra.clusterName, now); err != nil {
					r.logger.Error("record resolved", "fp", ra.fingerprint, "cluster", ra.clusterName, "err", err)
				} else if r.metrics != nil {
					r.metrics.AlertEventsTotal.WithLabelValues(ra.clusterName, models.EventStatusResolved).Inc()
				}
			}
			for _, ra := range resolvedAlerts {
				go func(ra resolvedAlert) {
					select {
					case <-ctx.Done():
						return
					case <-time.After(r.claimReleaseDelay):
					}
					// Re-check leadership at fire time — it may have changed
					// during the delay (D3 step 4: delayed claim-release is
					// leader-only).
					if !r.IsLeader() {
						return
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
		}
	}

	// In-memory resolved-buffer bookkeeping runs on every pod regardless of
	// leadership — it only feeds this pod's own AlertStore/WS clients, no DB
	// write involved (every pod serves reads/WS equally).
	if len(resolvedAlerts) > 0 {
		for _, ra := range resolvedAlerts {
			r.alertStore.MarkResolvedForCluster(ra.fingerprint, ra.clusterName)
			go func(ra resolvedAlert) {
				select {
				case <-ctx.Done():
				case <-time.After(20 * time.Minute):
					r.alertStore.RemoveResolvedForCluster(ra.fingerprint, ra.clusterName)
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

	if silencesChanged {
		r.hub.BroadcastJSON(models.WSTypeSilencesUpdate, struct{}{})
	}
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

// fetchCluster fetches and enriches (deduplicated, merged) alerts for a
// single cluster. Thin wrapper around cluster.Cluster.FetchAlerts, kept so
// tests can drive a single cluster fetch directly without going through poll().
func (r *Recorder) fetchCluster(ctx context.Context, cl *cluster.Cluster) ([]models.EnrichedAlert, error) {
	return cl.FetchAlerts(ctx, nil)
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
