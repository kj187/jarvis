package leader

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

// Binding Constants (tmp/fable/multi-replica.md) — use verbatim, do not rename.
const (
	// LockClassID / LockID identify the session-level advisory lock used for
	// leader election: pg_try_advisory_lock(0x4A525653, 1). One lock for all
	// leader duties, no fine-grained locks.
	LockClassID int32 = 0x4A525653 // "JRVS"
	LockID      int32 = 1

	// AcquireRetryInterval / HeartbeatInterval: 5s/5s. A follower re-attempts
	// pg_try_advisory_lock every AcquireRetryInterval; the leader heartbeats
	// its dedicated connection every HeartbeatInterval to detect connection
	// loss promptly (losing the connection releases the session lock).
	AcquireRetryInterval = 5 * time.Second
	HeartbeatInterval    = 5 * time.Second

	// TCP keepalive on the elector's dedicated connection bounds worst-case
	// failover after a hard node failure (no FIN, so the server-side session
	// would otherwise linger until the OS-default keepalive gives up, which
	// can take minutes): idle 5s, interval 3s, count 3.
	keepAliveIdle     = 5 * time.Second
	keepAliveInterval = 3 * time.Second
	keepAliveCount    = 3
)

// PGElector is the PostgreSQL-dialect Elector (D2): a dedicated connection
// (never the pool — pool connections get recycled) holds
// pg_try_advisory_lock(LockClassID, LockID). Session locks are released
// automatically by PostgreSQL when the connection drops, so a crashed or
// killed leader frees the lock without any TTL bookkeeping.
type PGElector struct {
	dsn    string
	logger *slog.Logger

	// retryInterval overrides AcquireRetryInterval/HeartbeatInterval for
	// tests, which would otherwise wait multiple real seconds per assertion.
	// Production callers leave this at its NewPGElector default (the Binding
	// Constant) — mirrors history.Store.SetGracePeriod's test-override style.
	retryInterval time.Duration

	mu       sync.RWMutex
	isLeader bool

	subsMu sync.Mutex
	subs   []func(bool)
}

// NewPGElector creates a PGElector against dsn (a postgres:// DSN). It does
// not connect until Run is called.
func NewPGElector(dsn string, logger *slog.Logger) *PGElector {
	return &PGElector{dsn: dsn, logger: logger, retryInterval: AcquireRetryInterval}
}

// SetRetryInterval overrides the acquire-retry/heartbeat interval. Test-only
// — production code should leave it at the Binding Constant default.
func (e *PGElector) SetRetryInterval(d time.Duration) {
	e.retryInterval = d
}

func (e *PGElector) IsLeader() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.isLeader
}

func (e *PGElector) Subscribe(fn func(bool)) {
	e.subsMu.Lock()
	e.subs = append(e.subs, fn)
	e.subsMu.Unlock()
}

func (e *PGElector) setLeader(v bool) {
	e.mu.Lock()
	changed := e.isLeader != v
	e.isLeader = v
	e.mu.Unlock()
	if !changed {
		return
	}
	e.subsMu.Lock()
	subs := make([]func(bool), len(e.subs))
	copy(subs, e.subs)
	e.subsMu.Unlock()
	for _, fn := range subs {
		fn(v)
	}
}

// Run drives the election loop until ctx is cancelled: dial a dedicated
// connection, then hold/attempt the advisory lock on it until the connection
// is lost, then redial. Callers start this in its own goroutine.
func (e *PGElector) Run(ctx context.Context) {
	for ctx.Err() == nil {
		conn, err := e.dial(ctx)
		if err != nil {
			e.logger.Error("leader election: connect failed, retrying", "err", err)
			e.setLeader(false)
			sleepCtx(ctx, e.retryInterval)
			continue
		}
		e.holdLock(ctx, conn)
	}
}

// dial opens a dedicated (non-pooled) connection with aggressive TCP
// keepalives, so a hard node failure is detected within a bounded time
// instead of the OS-default keepalive timeout (D2).
func (e *PGElector) dial(ctx context.Context) (*pgx.Conn, error) {
	cfg, err := pgx.ParseConfig(e.dsn)
	if err != nil {
		return nil, fmt.Errorf("parse dsn: %w", err)
	}
	dialer := &net.Dialer{
		KeepAliveConfig: net.KeepAliveConfig{
			Enable:   true,
			Idle:     keepAliveIdle,
			Interval: keepAliveInterval,
			Count:    keepAliveCount,
		},
	}
	cfg.DialFunc = dialer.DialContext
	return pgx.ConnectConfig(ctx, cfg)
}

// holdLock owns conn for its lifetime: while follower, it retries
// pg_try_advisory_lock every retryInterval; while leader, it heartbeats the
// connection every retryInterval instead (same interval value by Binding
// Constant, so one ticker serves both roles). Returns (releasing the
// connection and stepping down) when the connection is lost or ctx is
// cancelled — the caller's Run loop then redials.
func (e *PGElector) holdLock(ctx context.Context, conn *pgx.Conn) {
	defer func() {
		_ = conn.Close(context.Background())
		e.setLeader(false)
	}()

	ticker := time.NewTicker(e.retryInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}

		if e.IsLeader() {
			if err := conn.Ping(ctx); err != nil {
				e.logger.Warn("leader election: heartbeat failed, stepping down", "err", err)
				return
			}
			continue
		}

		var acquired bool
		if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1, $2)`, LockClassID, LockID).Scan(&acquired); err != nil {
			e.logger.Warn("leader election: try-lock query failed, reconnecting", "err", err)
			return
		}
		if acquired {
			e.logger.Info("leader election: acquired advisory lock, promoted")
			e.setLeader(true)
		}
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
