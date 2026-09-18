package history

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sort"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/models"
)

// snapshotKeepAliveIdle/Interval/Count and listenRetryInterval mirror
// internal/leader's Binding Constants (docs/postgres-ha.md D2): the
// same TCP-keepalive bound on hard-node-failure detection applies to every
// dedicated PostgreSQL connection, elector or LISTEN alike.
const (
	snapshotKeepAliveIdle     = 5 * time.Second
	snapshotKeepAliveInterval = 3 * time.Second
	snapshotKeepAliveCount    = 3
	listenRetryInterval       = 5 * time.Second

	// snapshotStaleFactor: a consumed snapshot older than this many poll
	// intervals is considered stale (Binding Constant: 3 × JARVIS_POLL_INTERVAL).
	snapshotStaleFactor = 3

	// followerBurstWindow (P5, tmp/memory.md §8.3): after a follower's first
	// jarvis_snapshot notification in an otherwise-idle stretch, wait this long
	// before rebuilding — coalescing several clusters' notifications that
	// arrive within milliseconds of each other (they persist their poll
	// snapshots in the same leader poll cycle) into a single rebuild instead
	// of one per notification. Fixed at the first signal of a burst: later
	// signals never push the deadline back, so a continuous notification
	// stream still rebuilds at least once per window instead of starving it.
	followerBurstWindow = 200 * time.Millisecond
)

// followerDirtySet collects cluster names touched by jarvis_snapshot
// notifications between batch-worker rebuilds. mark is called directly from
// the LISTEN goroutine and must stay cheap and non-blocking — all decoding
// and rebuilding happens later, on the batch worker's own goroutine.
type followerDirtySet struct {
	mu    sync.Mutex
	names map[string]struct{}
}

func newFollowerDirtySet() *followerDirtySet {
	return &followerDirtySet{names: make(map[string]struct{})}
}

func (d *followerDirtySet) mark(name string) {
	d.mu.Lock()
	d.names[name] = struct{}{}
	d.mu.Unlock()
}

// drain atomically empties the set and returns its names, sorted so a batch
// always processes clusters in a deterministic order.
func (d *followerDirtySet) drain() []string {
	d.mu.Lock()
	names := make([]string, 0, len(d.names))
	for name := range d.names {
		names = append(names, name)
	}
	d.names = make(map[string]struct{})
	d.mu.Unlock()
	sort.Strings(names)
	return names
}

// persistSnapshots writes and NOTIFYs this poll's per-cluster snapshot for
// every cluster (D3): a follower reconstructs its stores from these rows
// instead of polling Alertmanager itself. Only ever called while leader (see
// runPollLoop) against PostgreSQL (r.dsn is empty on SQLite, guarded by the
// caller) — PersistSnapshot/NotifySnapshotChanged are additionally
// self-guarded no-ops on SQLite as defense in depth.
func (r *Recorder) persistSnapshots(ctx context.Context, clusters []*cluster.Cluster) {
	now := time.Now().UTC()
	byCluster := make(map[string][]models.EnrichedAlert, len(clusters))
	for _, a := range r.alertStore.Get() {
		byCluster[a.ClusterName] = append(byCluster[a.ClusterName], a)
	}
	for _, cl := range clusters {
		snap := pollSnapshot{
			Alerts:   byCluster[cl.Name],
			Silences: r.silenceStore.GetCluster(cl.Name),
			MemberUp: cl.MemberUpStates(),
		}
		payload, err := encodeSnapshot(snap)
		if err != nil {
			r.logger.Error("encode snapshot", "cluster", cl.Name, "err", err)
			continue
		}
		if err := r.store.PersistSnapshot(ctx, cl.Name, payload, now); err != nil {
			r.logger.Error("persist snapshot", "cluster", cl.Name, "err", err)
			continue
		}
		if err := r.store.NotifySnapshotChanged(ctx, cl.Name); err != nil {
			r.logger.Error("notify snapshot changed", "cluster", cl.Name, "err", err)
		}
	}
}

// runFollowerLoop consumes leader-persisted snapshots instead of polling
// Alertmanager directly (D3) — this pod is currently a follower. It runs an
// independent LISTEN loop, batch worker, and full-resync ticker (P5, tmp/
// memory.md §8.3) and only returns once ctx is cancelled *and* all three have
// actually stopped — so Start's mode supervisor never begins the next mode
// while any of this loop's goroutines might still be reading/writing.
func (r *Recorder) runFollowerLoop(ctx context.Context) {
	r.resyncAllSnapshots(ctx)

	dirty := newFollowerDirtySet()
	signal := make(chan struct{}, 1)

	var wg sync.WaitGroup
	wg.Add(3)
	go func() {
		defer wg.Done()
		// No onIdle fallback here: a continuous stream of notifications for
		// other clusters must never mask one cluster's own notification
		// being lost — runFollowerResyncTicker below covers that
		// independently of how much notification traffic there is.
		r.listenLoop(ctx, notifyChannelSnapshot, r.interval,
			func(clusterName string) {
				dirty.mark(clusterName)
				select {
				case signal <- struct{}{}:
				default:
				}
			},
			nil,
		)
	}()
	go func() {
		defer wg.Done()
		r.runFollowerBatchWorker(ctx, dirty, signal)
	}()
	go func() {
		defer wg.Done()
		r.runFollowerResyncTicker(ctx)
	}()
	wg.Wait()
}

// runFollowerBatchWorker coalesces jarvis_snapshot notifications into at
// most one rebuild per burst: the first signal after being idle starts a
// fixed followerBurstWindow timer; every cluster marked dirty by the time it
// fires is resynced once (resyncSnapshotEntry, cache-only), then the whole
// AlertStore is rebuilt exactly once — never once per cluster or once per
// notification.
func (r *Recorder) runFollowerBatchWorker(ctx context.Context, dirty *followerDirtySet, signal <-chan struct{}) {
	var timer *time.Timer
	var timerC <-chan time.Time
	stop := func() {
		if timer != nil {
			timer.Stop()
			timer = nil
			timerC = nil
		}
	}
	defer stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-signal:
			if timer == nil {
				timer = time.NewTimer(followerBurstWindow)
				timerC = timer.C
			}
		case <-timerC:
			timer = nil
			timerC = nil
			names := dirty.drain()
			if len(names) == 0 {
				continue
			}
			for _, name := range names {
				if ctx.Err() != nil {
					return
				}
				r.resyncSnapshotEntry(ctx, name)
			}
			r.rebuildFollowerAlertStore()
		}
	}
}

// runFollowerResyncTicker performs a full resync every r.interval,
// independent of notification traffic — a genuine fallback for a missed
// jarvis_snapshot notification even while other clusters keep notifying
// continuously (the old onIdle-based fallback could be starved by exactly
// that).
func (r *Recorder) runFollowerResyncTicker(ctx context.Context) {
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.resyncAllSnapshots(ctx)
		}
	}
}

// resyncAllSnapshots reloads every cluster's snapshot from PostgreSQL — used
// on follower startup/reconnect and by the periodic full-resync ticker.
func (r *Recorder) resyncAllSnapshots(ctx context.Context) {
	all, err := r.store.GetAllSnapshots(ctx)
	if err != nil {
		r.logger.Error("resync all snapshots", "err", err)
		return
	}
	for clusterName, row := range all {
		r.applySnapshotRow(clusterName, row)
	}
	r.rebuildFollowerAlertStore()
}

// resyncSnapshotEntry reloads one cluster's snapshot into followerSnapshots
// only — the caller is responsible for calling rebuildFollowerAlertStore
// once after processing a whole batch of clusters, never after each one.
func (r *Recorder) resyncSnapshotEntry(ctx context.Context, clusterName string) {
	row, found, err := r.store.GetSnapshot(ctx, clusterName)
	if err != nil {
		r.logger.Error("resync snapshot", "cluster", clusterName, "err", err)
		return
	}
	if !found {
		return
	}
	r.applySnapshotRow(clusterName, row)
}

// applySnapshotRow decodes one cluster's snapshot row and updates this pod's
// silenceStore (immediately — SilenceStore is already the per-cluster cache)
// and its own followerSnapshots cache (merged into AlertStore by the caller's
// subsequent rebuildFollowerAlertStore call).
func (r *Recorder) applySnapshotRow(clusterName string, row snapshotRow) {
	snap, err := decodeSnapshot(row.Payload)
	if err != nil {
		r.logger.Error("decode snapshot", "cluster", clusterName, "err", err)
		return
	}
	if r.silenceStore != nil {
		r.silenceStore.Set(clusterName, snap.Silences)
	}
	snap.Alerts, _ = filterFollowerAlerts(snap.Alerts, row.TakenAt, r.currentTime())
	r.followerMu.Lock()
	if r.followerSnapshots == nil {
		r.followerSnapshots = make(map[string]followerSnapshotEntry)
	}
	r.followerSnapshots[clusterName] = followerSnapshotEntry{
		alerts:   snap.Alerts,
		memberUp: snap.MemberUp,
		takenAt:  row.TakenAt,
	}
	r.followerMu.Unlock()
}

func filterFollowerAlerts(alerts []models.EnrichedAlert, takenAt, now time.Time) ([]models.EnrichedAlert, bool) {
	kept := alerts[:0]
	removed := false
	for _, alert := range alerts {
		if alert.Status.State != "resolved" {
			kept = append(kept, alert)
			continue
		}
		if alert.EndsAt.IsZero() {
			removed = true
			continue
		}
		resolvedAt := alert.EndsAt.UTC()
		if !takenAt.IsZero() && takenAt.UTC().Before(resolvedAt) {
			resolvedAt = takenAt.UTC()
		}
		if !resolvedAt.Add(ResolvedBufferTTL).After(now) {
			removed = true
			continue
		}
		alert.EndsAt = resolvedAt
		alert.UpdatedAt = resolvedAt
		kept = append(kept, alert)
	}
	clear(alerts[len(kept):])
	return kept, removed
}

// rebuildFollowerAlertStore merges every cached cluster's alerts into this
// pod's AlertStore (Set replaces the whole store, so a per-cluster update
// must always re-merge the full set), updates the staleness gauge, and
// broadcasts to this pod's own WS clients if the merged view changed.
func (r *Recorder) rebuildFollowerAlertStore() {
	r.followerMu.Lock()
	merged := make([]models.EnrichedAlert, 0)
	stale := false
	threshold := snapshotStaleFactor * r.interval
	now := r.currentTime()
	for clusterName, entry := range r.followerSnapshots {
		var removed bool
		entry.alerts, removed = filterFollowerAlerts(entry.alerts, entry.takenAt, now)
		if removed {
			r.followerSnapshots[clusterName] = entry
		}
		merged = append(merged, entry.alerts...)
		if now.Sub(entry.takenAt) > threshold {
			stale = true
		}
	}
	r.followerMu.Unlock()

	// Re-hydrate active claims from the shared DB. The leader's snapshot only
	// carries claims as of its last poll, so a claim created against any pod
	// after that poll (patched into the local AlertStore by claims.go and
	// broadcast via fanout) would be wiped here and only reappear after the
	// leader's next poll. This is the same batched read the leader runs in
	// applyPollResults — claims are authoritative from the DB, not the
	// snapshot: a since-released claim still present in a stale snapshot is
	// cleared too.
	if claims, err := r.store.GetActiveClaims(); err != nil {
		r.logger.Error("follower: get active claims", "err", err)
	} else {
		for i := range merged {
			key := ClaimKey{Fingerprint: merged[i].Fingerprint, ClusterName: merged[i].ClusterName}
			merged[i].ActiveClaim = claims[key] // nil when the map has no entry
		}
	}

	if r.metrics != nil {
		if stale {
			r.metrics.SnapshotStale.Set(1)
		} else {
			r.metrics.SnapshotStale.Set(0)
		}
	}

	r.alertStore.Set(merged)
	r.broadcastAlertsIfChanged()
}

// listenLoop opens a dedicated LISTEN connection on channel and invokes
// onNotify with each notification's payload; if no notification arrives
// within resyncInterval, it invokes onIdle instead (a NOTIFY-miss fallback —
// onIdle may be nil to skip this). Runs until ctx is cancelled; reconnects on
// connection loss or dial failure, waiting listenRetryInterval between
// attempts.
func (r *Recorder) listenLoop(ctx context.Context, channel string, resyncInterval time.Duration, onNotify func(payload string), onIdle func()) {
	for ctx.Err() == nil {
		conn, err := r.dialListener(ctx, channel)
		if err != nil {
			r.logger.Error("listen: connect failed, retrying", "channel", channel, "err", err)
			sleepCtx(ctx, listenRetryInterval)
			continue
		}
		r.consumeNotifications(ctx, conn, resyncInterval, onNotify, onIdle)
	}
}

// dialListener opens a dedicated (non-pooled) PostgreSQL connection with
// aggressive TCP keepalives (D2) and issues LISTEN <channel> on it.
func (r *Recorder) dialListener(ctx context.Context, channel string) (*pgx.Conn, error) {
	cfg, err := pgx.ParseConfig(r.dsn)
	if err != nil {
		return nil, fmt.Errorf("parse dsn: %w", err)
	}
	dialer := &net.Dialer{
		KeepAliveConfig: net.KeepAliveConfig{
			Enable:   true,
			Idle:     snapshotKeepAliveIdle,
			Interval: snapshotKeepAliveInterval,
			Count:    snapshotKeepAliveCount,
		},
	}
	cfg.DialFunc = dialer.DialContext
	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if _, err := conn.Exec(ctx, "LISTEN "+channel); err != nil {
		_ = conn.Close(context.Background())
		return nil, fmt.Errorf("listen %s: %w", channel, err)
	}
	return conn, nil
}

// consumeNotifications owns conn for its lifetime, dispatching each
// notification to onNotify and falling back to onIdle when
// resyncInterval elapses without one. Returns (closing conn) when ctx is
// cancelled or the connection is lost — the caller's listenLoop then redials.
func (r *Recorder) consumeNotifications(ctx context.Context, conn *pgx.Conn, resyncInterval time.Duration, onNotify func(string), onIdle func()) {
	defer func() { _ = conn.Close(context.Background()) }()

	for {
		waitCtx, cancel := context.WithTimeout(ctx, resyncInterval)
		n, err := conn.WaitForNotification(waitCtx)
		cancel()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			if errors.Is(err, context.DeadlineExceeded) {
				if onIdle != nil {
					onIdle()
				}
				continue
			}
			// Info, not Warn: listenLoop immediately redials and re-LISTENs
			// (see below) — an occasional drop here (e.g. a pooler/proxy
			// recycling long-lived connections on a fixed lifetime) is
			// expected and self-healing, not an operator-actionable failure.
			r.logger.Info("listen: connection lost, reconnecting", "err", err)
			return
		}
		onNotify(n.Payload)
	}
}

// sleepCtx sleeps for d or returns early if ctx is cancelled.
func sleepCtx(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}
