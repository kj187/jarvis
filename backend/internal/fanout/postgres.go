package fanout

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Binding Constants (docs/persistence.md D4) — use verbatim, do not rename.
const (
	// NotifyChannel is the pg_notify channel WS mutation fanout uses.
	NotifyChannel = "jarvis_ws"

	// maxNotifyPayloadBytes leaves headroom under PostgreSQL's ~8000-byte
	// NOTIFY payload limit for the envelope's own JSON overhead (origin ID,
	// field names, escaping) — a message that would push the encoded
	// envelope past this is sent as a Ref instead.
	maxNotifyPayloadBytes = 7800

	// listenRetryInterval and the TCP keepalive bounds mirror
	// internal/leader's Binding Constants (D2): the same hard-node-failure
	// detection bound applies to every dedicated PostgreSQL connection.
	listenRetryInterval = 5 * time.Second
	keepAliveIdle       = 5 * time.Second
	keepAliveInterval   = 3 * time.Second
	keepAliveCount      = 3
)

// envelope is the wire format published on NotifyChannel: Origin identifies
// the publishing pod (echo suppression — see PGFanout.consume), and exactly
// one of Message/Ref is set (the reference fallback for oversized messages).
type envelope struct {
	Origin  string          `json:"origin"`
	Message json.RawMessage `json:"message,omitempty"`
	Ref     *Ref            `json:"ref,omitempty"`
}

// PGFanout is the PostgreSQL-dialect Fanout.
type PGFanout struct {
	db     *sql.DB // pooled connection — NOTIFY is a cheap statement, no dedicated connection needed to publish
	dsn    string  // dedicated LISTEN connection (never the pool — pool connections get recycled)
	logger *slog.Logger
	origin string
}

// NewPGFanout creates a PGFanout. db is the existing pooled *sql.DB (used
// only to issue NOTIFY); dsn is used to open the dedicated LISTEN connection
// in Run.
func NewPGFanout(db *sql.DB, dsn string, logger *slog.Logger) *PGFanout {
	return &PGFanout{db: db, dsn: dsn, logger: logger, origin: uuid.NewString()}
}

func (f *PGFanout) Publish(ctx context.Context, message []byte, ref Ref) {
	env := envelope{Origin: f.origin, Message: message}
	full, err := json.Marshal(env)
	if err != nil {
		f.logger.Error("fanout: marshal envelope failed", "err", err)
		return
	}
	if len(full) > maxNotifyPayloadBytes {
		env = envelope{Origin: f.origin, Ref: &ref}
		full, err = json.Marshal(env)
		if err != nil {
			f.logger.Error("fanout: marshal reference envelope failed", "err", err)
			return
		}
	}
	if _, err := f.db.ExecContext(ctx, `SELECT pg_notify('`+NotifyChannel+`', $1)`, string(full)); err != nil {
		f.logger.Error("fanout: publish failed", "err", err)
	}
}

func (f *PGFanout) Run(ctx context.Context, onMessage func([]byte), onRef func(Ref)) {
	for ctx.Err() == nil {
		conn, err := f.dial(ctx)
		if err != nil {
			f.logger.Error("fanout: connect failed, retrying", "err", err)
			sleepCtx(ctx, listenRetryInterval)
			continue
		}
		f.consume(ctx, conn, onMessage, onRef)
	}
}

// dial opens a dedicated (non-pooled) connection with aggressive TCP
// keepalives (D2) and issues LISTEN on it.
func (f *PGFanout) dial(ctx context.Context) (*pgx.Conn, error) {
	cfg, err := pgx.ParseConfig(f.dsn)
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
	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if _, err := conn.Exec(ctx, "LISTEN "+NotifyChannel); err != nil {
		_ = conn.Close(context.Background())
		return nil, fmt.Errorf("listen %s: %w", NotifyChannel, err)
	}
	return conn, nil
}

// consume owns conn for its lifetime, dispatching every notification not
// originated by this same PGFanout instance. Fanout is best-effort/fire-and-
// forget (unlike D3's snapshot distribution, there is no durable resync
// fallback here — a missed NOTIFY just means that one live update doesn't
// reach the other pod's clients; their next natural refetch still converges).
// Returns (closing conn) when ctx is cancelled or the connection is lost —
// the caller's Run loop then redials.
func (f *PGFanout) consume(ctx context.Context, conn *pgx.Conn, onMessage func([]byte), onRef func(Ref)) {
	defer func() { _ = conn.Close(context.Background()) }()

	for {
		n, err := conn.WaitForNotification(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			// Info, not Warn: the Run loop immediately redials and re-LISTENs
			// (see below) — an occasional drop here (e.g. a pooler/proxy
			// recycling long-lived connections on a fixed lifetime) is
			// expected and self-healing, not an operator-actionable failure.
			f.logger.Info("fanout: connection lost, reconnecting", "err", err)
			return
		}
		var env envelope
		if err := json.Unmarshal([]byte(n.Payload), &env); err != nil {
			f.logger.Error("fanout: unmarshal envelope failed", "err", err)
			continue
		}
		if env.Origin == f.origin {
			continue // echo suppression: this pod's own Publish
		}
		if env.Ref != nil {
			onRef(*env.Ref)
			continue
		}
		onMessage(env.Message)
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
