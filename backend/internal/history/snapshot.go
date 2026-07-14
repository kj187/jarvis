package history

import (
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/kj187/jarvis/backend/internal/alertmanager"
	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/models"
)

// Binding Constants (tmp/fable/multi-replica.md) — use verbatim, do not rename.
const (
	notifyChannelSnapshot = "jarvis_snapshot"
	notifyChannelTrigger  = "jarvis_trigger"
)

// pollSnapshot is the gzip'd-JSON payload stored in poll_snapshots (Resolved
// Decision 3): one row per cluster, holding everything a follower needs to
// serve reads/WS without polling Alertmanager itself.
type pollSnapshot struct {
	Alerts   []models.EnrichedAlert         `json:"alerts"`
	Silences []alertmanager.GettableSilence `json:"silences"`
	MemberUp map[string]bool                `json:"memberUp"`
}

func encodeSnapshot(s pollSnapshot) ([]byte, error) {
	raw, err := json.Marshal(s)
	if err != nil {
		return nil, fmt.Errorf("marshal snapshot: %w", err)
	}
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	if _, err := gw.Write(raw); err != nil {
		return nil, fmt.Errorf("gzip snapshot: %w", err)
	}
	if err := gw.Close(); err != nil {
		return nil, fmt.Errorf("gzip close: %w", err)
	}
	return buf.Bytes(), nil
}

func decodeSnapshot(payload []byte) (pollSnapshot, error) {
	var s pollSnapshot
	gr, err := gzip.NewReader(bytes.NewReader(payload))
	if err != nil {
		return s, fmt.Errorf("gunzip snapshot: %w", err)
	}
	defer func() { _ = gr.Close() }()
	raw, err := io.ReadAll(gr)
	if err != nil {
		return s, fmt.Errorf("read snapshot: %w", err)
	}
	if err := json.Unmarshal(raw, &s); err != nil {
		return s, fmt.Errorf("unmarshal snapshot: %w", err)
	}
	return s, nil
}

// snapshotRow is one poll_snapshots row, decoded down to payload + freshness.
type snapshotRow struct {
	Payload []byte
	TakenAt time.Time
}

// PersistSnapshot upserts the given cluster's poll snapshot. PostgreSQL only
// (D3) — SQLite has no poll_snapshots table and no followers to feed, so
// this is a deliberate no-op there.
func (s *Store) PersistSnapshot(ctx context.Context, clusterName string, payload []byte, takenAt time.Time) error {
	if s.dialect != idb.DialectPostgres {
		return nil
	}
	_, err := s.exec(ctx, `
		INSERT INTO poll_snapshots (cluster_name, payload, taken_at)
		VALUES (?, ?, ?)
		ON CONFLICT (cluster_name) DO UPDATE SET payload = excluded.payload, taken_at = excluded.taken_at
	`, clusterName, payload, takenAt.UTC())
	return err
}

// GetSnapshot returns one cluster's most recent snapshot. found is false if
// no snapshot exists yet (leader hasn't completed a poll of that cluster) or
// on SQLite (no poll_snapshots table).
func (s *Store) GetSnapshot(ctx context.Context, clusterName string) (row snapshotRow, found bool, err error) {
	if s.dialect != idb.DialectPostgres {
		return snapshotRow{}, false, nil
	}
	r := s.queryRow(ctx, `SELECT payload, taken_at FROM poll_snapshots WHERE cluster_name = ?`, clusterName)
	if err := r.Scan(&row.Payload, &row.TakenAt); err != nil {
		if err == sql.ErrNoRows {
			return snapshotRow{}, false, nil
		}
		return snapshotRow{}, false, err
	}
	row.TakenAt = row.TakenAt.UTC()
	return row, true, nil
}

// GetAllSnapshots returns every cluster's current snapshot, keyed by cluster
// name — used for a follower's full resync (on startup, on reconnect, and
// periodically as a NOTIFY-miss fallback). Empty map on SQLite.
func (s *Store) GetAllSnapshots(ctx context.Context) (map[string]snapshotRow, error) {
	if s.dialect != idb.DialectPostgres {
		return map[string]snapshotRow{}, nil
	}
	rows, err := s.query(ctx, `SELECT cluster_name, payload, taken_at FROM poll_snapshots`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	out := make(map[string]snapshotRow)
	for rows.Next() {
		var name string
		var row snapshotRow
		if err := rows.Scan(&name, &row.Payload, &row.TakenAt); err != nil {
			return nil, err
		}
		row.TakenAt = row.TakenAt.UTC()
		out[name] = row
	}
	return out, rows.Err()
}

// NotifySnapshotChanged publishes on the jarvis_snapshot channel so followers
// reload the given cluster's snapshot immediately instead of waiting for
// their periodic resync fallback. No-op on SQLite.
func (s *Store) NotifySnapshotChanged(ctx context.Context, clusterName string) error {
	if s.dialect != idb.DialectPostgres {
		return nil
	}
	_, err := s.exec(ctx, `SELECT pg_notify('`+notifyChannelSnapshot+`', ?)`, clusterName)
	return err
}

// NotifyTrigger publishes on the jarvis_trigger channel (D3 item 7): a
// follower cannot poll itself, so Recorder.Trigger() forwards here instead;
// the leader LISTENs on this channel and treats it exactly like a local
// Trigger() call. No-op on SQLite (Trigger() never needs to forward there —
// SQLite's StaticElector is always leader).
func (s *Store) NotifyTrigger(ctx context.Context) error {
	if s.dialect != idb.DialectPostgres {
		return nil
	}
	_, err := s.exec(ctx, `SELECT pg_notify('`+notifyChannelTrigger+`', '')`)
	return err
}
