package history

import (
	"context"
	"errors"
	"fmt"
	"net"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/models"
)

// snapshotKeepAliveIdle/Interval/Count and listenRetryInterval mirror
// internal/leader's Binding Constants (tmp/fable/multi-replica.md D2): the
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
)

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
// Alertmanager directly (D3) — this pod is currently a follower. Runs until
// ctx is cancelled (promotion or shutdown).
func (r *Recorder) runFollowerLoop(ctx context.Context) {
	r.resyncAllSnapshots(ctx)
	r.listenLoop(ctx, notifyChannelSnapshot, r.interval,
		func(clusterName string) { r.resyncSnapshot(ctx, clusterName) },
		func() { r.resyncAllSnapshots(ctx) },
	)
}

// resyncAllSnapshots reloads every cluster's snapshot from PostgreSQL — used
// on follower startup/reconnect and as the periodic NOTIFY-miss fallback.
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

// resyncSnapshot reloads one cluster's snapshot — triggered by a
// jarvis_snapshot notification carrying that cluster's name as payload.
func (r *Recorder) resyncSnapshot(ctx context.Context, clusterName string) {
	row, found, err := r.store.GetSnapshot(ctx, clusterName)
	if err != nil {
		r.logger.Error("resync snapshot", "cluster", clusterName, "err", err)
		return
	}
	if !found {
		return
	}
	r.applySnapshotRow(clusterName, row)
	r.rebuildFollowerAlertStore()
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
	r.followerMu.Lock()
	r.followerSnapshots[clusterName] = followerSnapshotEntry{
		alerts:   snap.Alerts,
		memberUp: snap.MemberUp,
		takenAt:  row.TakenAt,
	}
	r.followerMu.Unlock()
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
	now := time.Now()
	for _, entry := range r.followerSnapshots {
		merged = append(merged, entry.alerts...)
		if now.Sub(entry.takenAt) > threshold {
			stale = true
		}
	}
	r.followerMu.Unlock()

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
			r.logger.Warn("listen: connection lost, reconnecting", "err", err)
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
