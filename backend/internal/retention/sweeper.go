// Package retention implements the background data-retention sweep
// (idea 3.13, .agents/architecture.md). Fully opt-in: with the default
// config (config.RetentionConfig.Enabled() == false) the Sweeper's Start
// does nothing at all — no timer, no query, ever.
package retention

import (
	"context"
	"log/slog"
	"time"

	"github.com/kj187/jarvis/backend/internal/config"
	"github.com/kj187/jarvis/backend/internal/metrics"
)

// batchSize is the row count per DELETE batch, chosen so one sweep never
// holds SQLite's single-writer lock (Critical Invariant #8) for a long
// unbounded transaction.
const batchSize = 500

// startupDelay is how long Start waits before running the first sweep, so
// it doesn't compete with the rest of server boot.
const startupDelay = time.Minute

// store is the minimal interface the Sweeper needs from *history.Store —
// kept narrow so the Sweeper can be tested without a real DB.
type store interface {
	DeleteSweepableEventsBefore(ctx context.Context, cutoff time.Time, batch int) (int64, error)
	DetachCommentsAndClaimsFromSweepableEventsBefore(ctx context.Context, cutoff time.Time) (int64, error)
	DeleteReleasedClaimsBefore(ctx context.Context, cutoff time.Time, batch int) (int64, error)
	DeleteCommentsBefore(ctx context.Context, cutoff time.Time, batch int) (int64, error)
	DeleteSilenceEventsBefore(ctx context.Context, cutoff time.Time, batch int) (int64, error)
	DeleteOrphanFingerprintsBefore(ctx context.Context, cutoff time.Time, batch int) (int64, error)
}

// leaderChecker is the minimal leader-election view Sweeper needs from
// internal/leader.Elector — kept narrow so retention doesn't import
// internal/leader (mirrors the store interface above). nil means "always
// leader" (SQLite dialect, and tests that don't configure one).
type leaderChecker interface {
	IsLeader() bool
}

// Sweeper periodically deletes old rows per the configured retention rules.
type Sweeper struct {
	store   store
	cfg     config.RetentionConfig
	logger  *slog.Logger
	metrics *metrics.Metrics
	elector leaderChecker
}

// NewSweeper creates a Sweeper. m may be nil (same nil-safe pattern as
// history.NewRecorder / ws.NewHub). el may also be nil, meaning "always
// leader" — the retention sweeper is one of the D3-step-4 leader-only side
// effects (tmp/fable/multi-replica.md): only the leader may delete rows.
func NewSweeper(s store, cfg config.RetentionConfig, logger *slog.Logger, m *metrics.Metrics, el leaderChecker) *Sweeper {
	return &Sweeper{store: s, cfg: cfg, logger: logger, metrics: m, elector: el}
}

// shouldSweep reports whether this pod may run a sweep right now.
func (sw *Sweeper) shouldSweep() bool {
	return sw.elector == nil || sw.elector.IsLeader()
}

// Start runs the sweep loop until ctx is cancelled. No-ops immediately if
// retention is disabled (cfg.Enabled() == false) — an upgrade with the
// default config must never start deleting data. The first sweep runs
// startupDelay after Start is called; subsequent sweeps run every
// cfg.SweepInterval.
func (sw *Sweeper) Start(ctx context.Context) {
	if !sw.cfg.Enabled() {
		sw.logger.Info("retention sweeper disabled (no JARVIS_RETENTION_* configured)")
		return
	}

	timer := time.NewTimer(startupDelay)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			if sw.shouldSweep() {
				sw.sweep(ctx)
			}
			timer.Reset(sw.cfg.SweepInterval)
		}
	}
}

// sweep runs one full sweep across all domains, in FK-safe order: comments,
// claims, silence events (each independent, own/inherited retention), then
// detach comment/claim survivors from events about to be deleted, then the
// events themselves, then the orphan fingerprint sweep last (it must see
// the post-sweep state of every other table).
func (sw *Sweeper) sweep(ctx context.Context) {
	start := time.Now()
	logger := sw.logger.With("component", "retention")
	var total int64

	if days := sw.cfg.EffectiveCommentsDays(); days > 0 {
		n, err := sw.store.DeleteCommentsBefore(ctx, cutoffDays(days), batchSize)
		sw.recordResult(logger, "alert_comments", n, err)
		total += n
	}

	if days := sw.cfg.EffectiveClaimsDays(); days > 0 {
		n, err := sw.store.DeleteReleasedClaimsBefore(ctx, cutoffDays(days), batchSize)
		sw.recordResult(logger, "alert_claims", n, err)
		total += n
	}

	if days := sw.cfg.EffectiveSilenceEventsDays(); days > 0 {
		n, err := sw.store.DeleteSilenceEventsBefore(ctx, cutoffDays(days), batchSize)
		sw.recordResult(logger, "silence_events", n, err)
		total += n
	}

	if days := sw.cfg.EffectiveEventsDays(); days > 0 {
		cutoff := cutoffDays(days)
		if _, err := sw.store.DetachCommentsAndClaimsFromSweepableEventsBefore(ctx, cutoff); err != nil {
			logger.Error("detach comments/claims from sweepable events", "err", err)
		}
		n, err := sw.store.DeleteSweepableEventsBefore(ctx, cutoff, batchSize)
		sw.recordResult(logger, "alert_events", n, err)
		total += n
	}

	// Orphan fingerprint sweep runs last, using the widest cutoff of all
	// configured domains: a fingerprint may only vanish once nothing
	// references it AND it is older than everything that could still
	// reference it.
	if widest := sw.widestEffectiveDays(); widest > 0 {
		n, err := sw.store.DeleteOrphanFingerprintsBefore(ctx, cutoffDays(widest), batchSize)
		sw.recordResult(logger, "alert_fingerprints", n, err)
		total += n
	}

	duration := time.Since(start)
	if sw.metrics != nil {
		sw.metrics.RetentionSweepsTotal.Inc()
		sw.metrics.RetentionSweepDuration.Observe(duration.Seconds())
	}
	logger.Info("retention sweep complete", "deleted_rows", total, "duration", duration)
}

func (sw *Sweeper) recordResult(logger *slog.Logger, table string, n int64, err error) {
	if err != nil {
		logger.Error("retention delete failed", "table", table, "err", err)
		return
	}
	if sw.metrics != nil {
		sw.metrics.RetentionDeletedRowsTotal.WithLabelValues(table).Add(float64(n))
	}
	if n > 0 {
		logger.Info("retention delete", "table", table, "deleted", n)
	}
}

// widestEffectiveDays returns the largest effective retention across all
// four domains — the cutoff the orphan fingerprint sweep must use.
func (sw *Sweeper) widestEffectiveDays() int {
	widest := sw.cfg.EffectiveEventsDays()
	if d := sw.cfg.EffectiveClaimsDays(); d > widest {
		widest = d
	}
	if d := sw.cfg.EffectiveSilenceEventsDays(); d > widest {
		widest = d
	}
	if d := sw.cfg.EffectiveCommentsDays(); d > widest {
		widest = d
	}
	return widest
}

func cutoffDays(days int) time.Time {
	return time.Now().UTC().AddDate(0, 0, -days)
}
