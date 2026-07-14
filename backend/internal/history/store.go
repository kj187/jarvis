package history

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/models"
)

// Claim-update sentinel errors returned by UpdateClaimNote.
var (
	// ErrNoActiveClaim indicates there is no active claim to update.
	ErrNoActiveClaim = errors.New("no active claim")
	// ErrNotClaimOwner indicates the requester is not the owner of the active claim.
	ErrNotClaimOwner = errors.New("not claim owner")
)

// defaultGracePeriod is the grace period used until SetGracePeriod overrides
// it. 60s is the invariant's historical baseline value.
const defaultGracePeriod = 60 * time.Second

// Store handles all database persistence for alerts.
type Store struct {
	db      *sql.DB
	dialect idb.Dialect

	// gracePeriod is Critical Invariant #1's window (AGENTS.md): a re-fire
	// within this long of a recorded resolve reopens the old event instead
	// of creating a new one. Set once at startup via SetGracePeriod, before
	// the recorder starts polling — RecordStatusChange only reads it
	// afterward, so no lock is needed.
	gracePeriod time.Duration
}

// NewStore creates a new Store with the given database connection and dialect.
func NewStore(database *sql.DB, dialect idb.Dialect) *Store {
	return &Store{db: database, dialect: dialect, gracePeriod: defaultGracePeriod}
}

// SetGracePeriod overrides the grace period (Critical Invariant #1) used by
// RecordStatusChange. Must be called before the recorder starts polling —
// see the field's own doc comment. Callers should keep this at least
// 2×JARVIS_POLL_INTERVAL, so a single missed poll can never make a
// resolve+refire pair permanently split into two episodes.
func (s *Store) SetGracePeriod(d time.Duration) {
	s.gracePeriod = d
}

// ── Query helpers ─────────────────────────────────────────────────────────────

// rebind converts SQLite-style ? placeholders to PostgreSQL $N placeholders.
func rebind(dialect idb.Dialect, query string) string {
	if dialect == idb.DialectSQLite {
		return query
	}
	n := 0
	var b strings.Builder
	b.Grow(len(query) + 16)
	for _, ch := range query {
		if ch == '?' {
			n++
			b.WriteByte('$')
			b.WriteString(strconv.Itoa(n))
		} else {
			b.WriteRune(ch)
		}
	}
	return b.String()
}

// queryer is satisfied by both *sql.DB and *sql.Tx, so query helpers can run
// either directly on the pool or inside a transaction (see withTx).
type queryer interface {
	ExecContext(ctx context.Context, query string, args ...interface{}) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...interface{}) *sql.Row
}

func (s *Store) execOn(q queryer, ctx context.Context, query string, args ...interface{}) (sql.Result, error) {
	return q.ExecContext(ctx, rebind(s.dialect, query), args...)
}

func (s *Store) queryRowOn(q queryer, ctx context.Context, query string, args ...interface{}) *sql.Row {
	return q.QueryRowContext(ctx, rebind(s.dialect, query), args...)
}

func (s *Store) queryOn(q queryer, ctx context.Context, query string, args ...interface{}) (*sql.Rows, error) {
	return q.QueryContext(ctx, rebind(s.dialect, query), args...)
}

func (s *Store) exec(ctx context.Context, query string, args ...interface{}) (sql.Result, error) {
	return s.execOn(s.db, ctx, query, args...)
}

func (s *Store) queryRow(ctx context.Context, query string, args ...interface{}) *sql.Row {
	return s.queryRowOn(s.db, ctx, query, args...)
}

func (s *Store) query(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error) {
	return s.queryOn(s.db, ctx, query, args...)
}

// withTx runs fn inside a transaction, committing on success and rolling
// back on error or panic. Critical Invariant #D5: RecordStatusChange's
// read-last → grace-delete → insert → count-update sequence must be atomic,
// so a demoted leader mid-sequence during failover can't interleave with the
// newly promoted leader's write of the same episode.
func (s *Store) withTx(ctx context.Context, fn func(tx *sql.Tx) error) (err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback()
			panic(p)
		}
	}()
	if err := fn(tx); err != nil {
		if rbErr := tx.Rollback(); rbErr != nil && !errors.Is(rbErr, sql.ErrTxDone) {
			return fmt.Errorf("%w (rollback: %v)", err, rbErr)
		}
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func parseNullableTimeValue(raw interface{}) (sql.NullTime, error) {
	switch v := raw.(type) {
	case nil:
		return sql.NullTime{}, nil
	case time.Time:
		return sql.NullTime{Time: v, Valid: true}, nil
	case string:
		return parseNullableTimeString(v)
	case []byte:
		return parseNullableTimeString(string(v))
	default:
		return sql.NullTime{}, fmt.Errorf("unsupported time value type %T", raw)
	}
}

func parseNullableTimeString(value string) (sql.NullTime, error) {
	if value == "" {
		return sql.NullTime{}, nil
	}
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05.999999999 -0700 MST",
		"2006-01-02 15:04:05 -0700 MST",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, value); err == nil {
			return sql.NullTime{Time: t, Valid: true}, nil
		}
	}
	return sql.NullTime{}, fmt.Errorf("unsupported time format %q", value)
}

// insertReturningID executes an INSERT and returns the new row ID.
// PostgreSQL: appends RETURNING id and uses QueryRowContext.
// SQLite: uses ExecContext + LastInsertId.
func (s *Store) insertReturningID(ctx context.Context, query string, args ...interface{}) (int64, error) {
	return s.insertReturningIDOn(s.db, ctx, query, args...)
}

func (s *Store) insertReturningIDOn(q queryer, ctx context.Context, query string, args ...interface{}) (int64, error) {
	rq := rebind(s.dialect, query)
	if s.dialect == idb.DialectPostgres {
		var id int64
		if err := q.QueryRowContext(ctx, rq+" RETURNING id", args...).Scan(&id); err != nil {
			return 0, err
		}
		return id, nil
	}
	res, err := q.ExecContext(ctx, rq, args...)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// ── Fingerprints ──────────────────────────────────────────────────────────────

// UpsertFingerprint inserts or updates an alert fingerprint record.
func (s *Store) UpsertFingerprint(fingerprint, alertname, clusterName string, labels map[string]string) error {
	labelsJSON, err := json.Marshal(labels)
	if err != nil {
		return fmt.Errorf("marshal labels: %w", err)
	}
	now := time.Now().UTC()
	_, err = s.exec(context.Background(), `
		INSERT INTO alert_fingerprints (fingerprint, alertname, cluster_name, labels, first_seen_at, last_seen_at, occurrence_count)
		VALUES (?, ?, ?, ?, ?, ?, 1)
		ON CONFLICT(fingerprint) DO UPDATE SET
			last_seen_at = excluded.last_seen_at
	`, fingerprint, alertname, clusterName, string(labelsJSON), now, now)
	return err
}

// ── Events ────────────────────────────────────────────────────────────────────

// RecordStatusChange records a status transition as an immutable append-only row.
// Idempotent: if the last recorded status equals the new status, no row is inserted.
// Grace Period (s.gracePeriod, defaults to 60s): if the alert re-fires within
// that window of a resolved row, that resolved row is deleted and the prior
// firing row is returned — no new insert.
// occurrence_count is incremented only when re-firing after a full resolution.
// The bool return reports whether a new event row was actually inserted —
// callers that count lifecycle events (metrics) must rely on it instead of
// re-deriving the idempotency/grace-period decision themselves.
func (s *Store) RecordStatusChange(
	fingerprint, clusterName, amURL, status string,
	startsAt time.Time,
	annotations map[string]string,
) (*models.AlertEvent, bool, error) {
	ctx := context.Background()
	var (
		event   *models.AlertEvent
		created bool
	)
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		// D5: serialize concurrent writers for this episode. PostgreSQL only —
		// SQLite is already single-writer via SetMaxOpenConns(1), so a second
		// transaction can't even begin until this one commits or rolls back.
		if s.dialect == idb.DialectPostgres {
			lockKey := fingerprint + ":" + clusterName
			if _, err := tx.ExecContext(ctx, rebind(s.dialect, `SELECT pg_advisory_xact_lock(hashtext(?))`), lockKey); err != nil {
				return fmt.Errorf("acquire episode lock: %w", err)
			}
		}

		last, err := s.getLastEventForClusterOn(tx, ctx, fingerprint, clusterName)
		if err != nil {
			return err
		}

		// Idempotency: same status → return existing row unchanged.
		if last != nil && last.Status == status {
			event, created = last, false
			return nil
		}

		lastStatus := ""
		if last != nil {
			lastStatus = last.Status
		}

		// Grace Period: alert re-fires within the configured window of resolved → discard resolved row.
		if status == models.EventStatusFiring && lastStatus == models.EventStatusResolved {
			if time.Since(last.RecordedAt) < s.gracePeriod {
				if _, err := s.execOn(tx, ctx, `DELETE FROM alert_events WHERE id = ?`, last.ID); err != nil {
					return fmt.Errorf("grace period delete resolved: %w", err)
				}
				prev, err := s.getLastEventForClusterOn(tx, ctx, fingerprint, clusterName)
				if err != nil {
					return err
				}
				if prev != nil {
					event, created = prev, false
					return nil
				}
				// No prior row after deletion — fall through to insert a fresh firing row.
				// Reset lastStatus so occurrence_count is not incremented.
				lastStatus = ""
			}
		}

		annJSON, err := json.Marshal(annotations)
		if err != nil {
			return fmt.Errorf("marshal annotations: %w", err)
		}
		now := time.Now().UTC()
		id, err := s.insertReturningIDOn(tx, ctx, `
			INSERT INTO alert_events (fingerprint, cluster_name, alertmanager_url, status, starts_at, annotations, recorded_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, fingerprint, clusterName, amURL, status, startsAt.UTC(), string(annJSON), now)
		if err != nil {
			return fmt.Errorf("insert status change: %w", err)
		}

		// Increment occurrence_count only on genuine re-fire after full resolution.
		if status == models.EventStatusFiring && lastStatus == models.EventStatusResolved {
			if _, err := s.execOn(tx, ctx,
				`UPDATE alert_fingerprints SET occurrence_count = occurrence_count + 1 WHERE fingerprint = ? AND cluster_name = ?`,
				fingerprint, clusterName,
			); err != nil {
				return fmt.Errorf("increment occurrence_count: %w", err)
			}
		}

		event = &models.AlertEvent{
			ID:              id,
			Fingerprint:     fingerprint,
			ClusterName:     clusterName,
			AlertmanagerURL: amURL,
			Status:          status,
			StartsAt:        startsAt.UTC(),
			RecordedAt:      now,
		}
		created = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return event, created, nil
}

// RecordResolved inserts a resolved row for a fingerprint, inheriting cluster
// info and starts_at from the last known event. No-op if already resolved or
// no history exists for this fingerprint.
func (s *Store) RecordResolved(fingerprint string, resolvedAt time.Time) error {
	return s.RecordResolvedForCluster(fingerprint, "", resolvedAt)
}

func (s *Store) RecordResolvedForCluster(fingerprint, clusterName string, resolvedAt time.Time) error {
	last, err := s.getLastEventForCluster(fingerprint, clusterName)
	if err != nil {
		return err
	}
	if last == nil || last.Status == models.EventStatusResolved {
		return nil
	}
	_, err = s.exec(context.Background(), `
		INSERT INTO alert_events (fingerprint, cluster_name, alertmanager_url, status, starts_at, annotations, recorded_at)
		VALUES (?, ?, ?, 'resolved', ?, ?, ?)
	`, fingerprint, last.ClusterName, last.AlertmanagerURL, last.StartsAt.UTC(), last.Annotations, resolvedAt.UTC())
	return err
}

// GetOpenFingerprintsForCluster returns fingerprints in the given cluster
// whose most recent alert_event (recorded within window) is not "resolved"
// — i.e. alerts the DB still considers open. Used for startup
// reconciliation: after a Jarvis restart, in-memory prevSnapshot is empty,
// so the normal poll diff can't tell "resolved during downtime" apart from
// "just started" — this query finds the candidates directly in the DB.
// Scoped to window so old/stale fingerprints from long-abandoned alerts
// aren't dragged into every startup's reconciliation pass.
func (s *Store) GetOpenFingerprintsForCluster(clusterName string, window time.Duration) ([]string, error) {
	since := time.Now().UTC().Add(-window)
	rows, err := s.query(context.Background(), `
		SELECT fingerprint FROM alert_events
		WHERE cluster_name = ? AND status != ? AND id IN (
			SELECT MAX(id) FROM alert_events
			WHERE cluster_name = ? AND recorded_at >= ?
			GROUP BY fingerprint
		)
	`, clusterName, models.EventStatusResolved, clusterName, since)
	if err != nil {
		return nil, fmt.Errorf("get open fingerprints for cluster: %w", err)
	}
	defer func() { _ = rows.Close() }()

	fingerprints := make([]string, 0)
	for rows.Next() {
		var fp string
		if err := rows.Scan(&fp); err != nil {
			return nil, fmt.Errorf("scan open fingerprint: %w", err)
		}
		fingerprints = append(fingerprints, fp)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return fingerprints, nil
}

// GetHistory returns paginated alert events for a fingerprint (newest first).
func (s *Store) GetHistory(fingerprint string, limit, offset int) ([]models.AlertEvent, int, error) {
	return s.GetHistoryForCluster(fingerprint, "", limit, offset)
}

// GetHistoryForCluster returns paginated alert events for a fingerprint,
// optionally scoped to one cluster (newest first).
func (s *Store) GetHistoryForCluster(fingerprint, clusterName string, limit, offset int) ([]models.AlertEvent, int, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	clusterFilter := ""
	args := []interface{}{fingerprint}
	if clusterName != "" {
		clusterFilter = " AND cluster_name = ?"
		args = append(args, clusterName)
	}

	var total int
	if err := s.queryRow(context.Background(), `
		SELECT COUNT(*) FROM alert_events WHERE fingerprint = ?`+clusterFilter,
		args...,
	).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count events: %w", err)
	}

	queryArgs := append([]interface{}{}, args...)
	queryArgs = append(queryArgs, limit, offset)
	rows, err := s.query(context.Background(), `
		SELECT id, fingerprint, cluster_name, alertmanager_url, status, starts_at, ends_at, annotations, recorded_at
		FROM alert_events
		WHERE fingerprint = ?`+clusterFilter+`
		ORDER BY recorded_at DESC
		LIMIT ? OFFSET ?
	`, queryArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("query events: %w", err)
	}
	defer func() { _ = rows.Close() }()

	events := make([]models.AlertEvent, 0)
	for rows.Next() {
		var e models.AlertEvent
		var endsAt sql.NullTime
		var annotationsNull sql.NullString
		var startsAt, recordedAt time.Time
		if err := rows.Scan(&e.ID, &e.Fingerprint, &e.ClusterName, &e.AlertmanagerURL,
			&e.Status, &startsAt, &endsAt, &annotationsNull, &recordedAt); err != nil {
			return nil, 0, fmt.Errorf("scan event: %w", err)
		}
		e.Annotations = annotationsNull.String
		e.StartsAt = startsAt.UTC()
		e.RecordedAt = recordedAt.UTC()
		if endsAt.Valid {
			t := endsAt.Time.UTC()
			e.EndsAt = &t
		}
		events = append(events, e)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return events, total, nil
}

// GetFiringStarts returns one recorded time per distinct firing episode for
// a fingerprint (optionally cluster-scoped) since the given time, newest
// first, capped at limit. Uses recorded_at (when Jarvis observed the
// event), not starts_at (Alertmanager's upstream condition-start time), so
// the heatmap bucketing agrees with "Last fired" and the history log —
// otherwise a poll gap between AM's StartsAt and Jarvis first seeing it
// makes the same single event appear at two different times in the UI.
// Grouped by starts_at (Alertmanager's episode identity) so a silence
// expiring mid-episode — which produces a fresh "firing" row (suppressed ->
// expired -> firing, since the last event was "expired" not "firing") with
// the *same* starts_at as the original episode — is counted once, not
// twice. The grace period (invariant #1) only dedupes resolve+refire within
// 60s; it does not cover this suppressed/expired/firing sequence, so the
// dedup has to happen here.
func (s *Store) GetFiringStarts(fingerprint, clusterName string, since time.Time, limit int) ([]time.Time, error) {
	if limit <= 0 || limit > 10000 {
		limit = 10000
	}

	clusterFilter := ""
	args := []interface{}{fingerprint, models.EventStatusFiring, since.UTC()}
	if clusterName != "" {
		clusterFilter = " AND cluster_name = ?"
		args = append(args, clusterName)
	}
	args = append(args, limit)

	rows, err := s.query(context.Background(), `
		SELECT recorded_at FROM (
			SELECT recorded_at,
			       ROW_NUMBER() OVER (PARTITION BY starts_at ORDER BY recorded_at ASC) AS rn
			FROM alert_events
			WHERE fingerprint = ? AND status = ? AND recorded_at >= ?`+clusterFilter+`
		) episodes
		WHERE rn = 1
		ORDER BY recorded_at DESC
		LIMIT ?
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("query firing starts: %w", err)
	}
	defer func() { _ = rows.Close() }()

	starts := make([]time.Time, 0)
	for rows.Next() {
		var t time.Time
		if err := rows.Scan(&t); err != nil {
			return nil, fmt.Errorf("scan firing start: %w", err)
		}
		starts = append(starts, t.UTC())
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return starts, nil
}

// GetTimeline returns a merged, paginated timeline for a fingerprint.
// Rows are ordered by recorded timestamp (newest first).
func (s *Store) GetTimeline(fingerprint, clusterName string, limit, offset int) ([]models.AlertTimelineEntry, int, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	clusterFilter := ""
	argsAlert := []interface{}{fingerprint}
	argsClaim := []interface{}{fingerprint}
	argsSilence := []interface{}{fingerprint}
	if clusterName != "" {
		clusterFilter = " AND cluster_name = ?"
		argsAlert = append(argsAlert, clusterName)
		argsClaim = append(argsClaim, clusterName)
		argsSilence = append(argsSilence, clusterName)
	}

	countQuery := `
		SELECT COUNT(*) FROM (
			SELECT 1 FROM alert_events WHERE fingerprint = ?` + clusterFilter + `
			UNION ALL
			SELECT 1 FROM alert_claims WHERE fingerprint = ?` + clusterFilter + `
			UNION ALL
			SELECT 1 FROM alert_claims WHERE fingerprint = ?` + clusterFilter + ` AND released_at IS NOT NULL
			UNION ALL
			SELECT 1 FROM silence_events WHERE fingerprint = ?` + clusterFilter + `
		) AS timeline_count
	`

	countArgs := make([]interface{}, 0, len(argsAlert)+len(argsClaim)*2+len(argsSilence))
	countArgs = append(countArgs, argsAlert...)
	countArgs = append(countArgs, argsClaim...)
	countArgs = append(countArgs, argsClaim...)
	countArgs = append(countArgs, argsSilence...)

	var total int
	if err := s.queryRow(context.Background(), countQuery, countArgs...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count timeline: %w", err)
	}

	query := `
		SELECT source, source_id, recorded_at, who, action, comment, silence_id
		FROM (
			SELECT
				'alert' AS source,
				id AS source_id,
				recorded_at,
				'system' AS who,
				status AS action,
				'' AS comment,
				NULL AS silence_id
			FROM alert_events
			WHERE fingerprint = ?` + clusterFilter + `

			UNION ALL

			SELECT
				'claim' AS source,
				id AS source_id,
				claimed_at AS recorded_at,
				claimed_by AS who,
				'claimed' AS action,
				note AS comment,
				NULL AS silence_id
			FROM alert_claims
			WHERE fingerprint = ?` + clusterFilter + `

			UNION ALL

			SELECT
				'claim' AS source,
				id AS source_id,
				released_at AS recorded_at,
				COALESCE(released_by, 'system') AS who,
				'unclaimed' AS action,
				COALESCE(release_reason, '') AS comment,
				NULL AS silence_id
			FROM alert_claims
			WHERE fingerprint = ?` + clusterFilter + ` AND released_at IS NOT NULL

			UNION ALL

			SELECT
				'silence' AS source,
				id AS source_id,
				recorded_at,
				performed_by AS who,
				action,
				comment,
				silence_id
			FROM silence_events
			WHERE fingerprint = ?` + clusterFilter + `
		) AS timeline
		ORDER BY recorded_at DESC
		LIMIT ? OFFSET ?
	`

	queryArgs := make([]interface{}, 0, len(countArgs)+2)
	queryArgs = append(queryArgs, countArgs...)
	queryArgs = append(queryArgs, limit, offset)
	rows, err := s.query(context.Background(), query, queryArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("query timeline: %w", err)
	}
	defer func() { _ = rows.Close() }()

	entries := make([]models.AlertTimelineEntry, 0)
	for rows.Next() {
		var e models.AlertTimelineEntry
		var recordedAt time.Time
		var comment, silenceID sql.NullString
		if err := rows.Scan(&e.Source, &e.SourceID, &recordedAt, &e.Who, &e.Action, &comment, &silenceID); err != nil {
			return nil, 0, fmt.Errorf("scan timeline row: %w", err)
		}
		e.RecordedAt = recordedAt.UTC()
		if comment.Valid {
			e.Comment = comment.String
		}
		if silenceID.Valid {
			e.SilenceID = silenceID.String
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	return entries, total, nil
}

// GetStats returns occurrence statistics for a fingerprint.
func (s *Store) GetStats(fingerprint string) (*models.AlertStats, error) {
	return s.GetStatsForCluster(fingerprint, "")
}

// GetStatsForCluster returns occurrence statistics for a fingerprint, optionally scoped to a cluster.
func (s *Store) GetStatsForCluster(fingerprint, clusterName string) (*models.AlertStats, error) {
	var st models.AlertStats
	q := `
		SELECT fingerprint, alertname, cluster_name, first_seen_at, last_seen_at, occurrence_count
		FROM alert_fingerprints
		WHERE fingerprint = ?
		ORDER BY last_seen_at DESC LIMIT 1
	`

	err := s.queryRow(context.Background(), q, fingerprint).Scan(
		&st.Fingerprint, &st.Alertname, &st.ClusterName, &st.FirstSeenAt, &st.LastSeenAt, &st.OccurrenceCount,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get stats: %w", err)
	}
	st.FirstSeenAt = st.FirstSeenAt.UTC()
	st.LastSeenAt = st.LastSeenAt.UTC()

	if clusterName != "" {
		st.ClusterName = clusterName
		var firstByClusterRaw, lastByClusterRaw interface{}
		if err := s.queryRow(context.Background(), `
			SELECT MIN(recorded_at), MAX(recorded_at)
			FROM alert_events
			WHERE fingerprint = ? AND cluster_name = ?
		`, fingerprint, clusterName).Scan(&firstByClusterRaw, &lastByClusterRaw); err != nil {
			return nil, fmt.Errorf("query per-cluster first/last seen: %w", err)
		}
		firstByCluster, err := parseNullableTimeValue(firstByClusterRaw)
		if err != nil {
			return nil, fmt.Errorf("parse per-cluster first seen: %w", err)
		}
		lastByCluster, err := parseNullableTimeValue(lastByClusterRaw)
		if err != nil {
			return nil, fmt.Errorf("parse per-cluster last seen: %w", err)
		}
		if firstByCluster.Valid {
			st.FirstSeenAt = firstByCluster.Time.UTC()
		}
		if lastByCluster.Valid {
			st.LastSeenAt = lastByCluster.Time.UTC()
		}
		// occurrence_count in alert_fingerprints is keyed per fingerprint (legacy schema),
		// so derive per-cluster occurrences from lifecycle transitions.
		if err := s.queryRow(context.Background(), `
			SELECT COUNT(*) FROM (
				SELECT
					status,
					LAG(status) OVER (ORDER BY recorded_at, id) AS prev_status
				FROM alert_events
				WHERE fingerprint = ? AND cluster_name = ?
			) transitions
			WHERE status = 'firing' AND (prev_status IS NULL OR prev_status = 'resolved')
		`, fingerprint, clusterName).Scan(&st.OccurrenceCount); err != nil {
			return nil, fmt.Errorf("count per-cluster occurrences: %w", err)
		}
	}

	var resolvedAtRaw interface{}
	resolvedArgs := []interface{}{fingerprint}
	resolvedClusterFilter := ""
	if clusterName != "" {
		resolvedClusterFilter = " AND cluster_name = ?"
		resolvedArgs = append(resolvedArgs, clusterName)
	}
	_ = s.queryRow(context.Background(), `
		SELECT recorded_at FROM alert_events
		WHERE fingerprint = ?`+resolvedClusterFilter+` AND status = 'resolved'
		ORDER BY recorded_at DESC LIMIT 1
	`, resolvedArgs...).Scan(&resolvedAtRaw)
	resolvedAt, err := parseNullableTimeValue(resolvedAtRaw)
	if err != nil {
		return nil, fmt.Errorf("parse last resolved time: %w", err)
	}
	if resolvedAt.Valid {
		t := resolvedAt.Time.UTC()
		st.LastResolvedAt = &t
	}

	var firedAtRaw interface{}
	firedArgs := []interface{}{fingerprint}
	firedClusterFilter := ""
	if clusterName != "" {
		firedClusterFilter = " AND cluster_name = ?"
		firedArgs = append(firedArgs, clusterName)
	}
	_ = s.queryRow(context.Background(), `
		SELECT recorded_at FROM alert_events
		WHERE fingerprint = ?`+firedClusterFilter+` AND status = 'firing'
		ORDER BY recorded_at DESC LIMIT 1
	`, firedArgs...).Scan(&firedAtRaw)
	firedAt, err := parseNullableTimeValue(firedAtRaw)
	if err != nil {
		return nil, fmt.Errorf("parse last fired time: %w", err)
	}
	if firedAt.Valid {
		t := firedAt.Time.UTC()
		st.LastFiredAt = &t
	}

	return &st, nil
}

// ── Comments ──────────────────────────────────────────────────────────────────

// GetComments returns paginated comments for a (fingerprint, cluster) pair
// (newest first) plus the total count across all pages.
func (s *Store) GetComments(fingerprint, clusterName string, limit, offset int) ([]models.Comment, int, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	var total int
	if err := s.queryRow(context.Background(), `
		SELECT COUNT(*) FROM alert_comments WHERE fingerprint = ? AND cluster_name = ?
	`, fingerprint, clusterName).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count comments: %w", err)
	}

	rows, err := s.query(context.Background(), `
		SELECT id, fingerprint, cluster_name, event_id, user_id, author_name, body, created_at
		FROM alert_comments
		WHERE fingerprint = ? AND cluster_name = ?
		ORDER BY created_at DESC, id DESC
		LIMIT ? OFFSET ?
	`, fingerprint, clusterName, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("query comments: %w", err)
	}
	defer func() { _ = rows.Close() }()

	comments := make([]models.Comment, 0)
	for rows.Next() {
		var c models.Comment
		var eventID sql.NullInt64
		var userID sql.NullString
		var createdAt time.Time
		if err := rows.Scan(&c.ID, &c.Fingerprint, &c.ClusterName, &eventID, &userID, &c.AuthorName, &c.Body, &createdAt); err != nil {
			return nil, 0, fmt.Errorf("scan comment: %w", err)
		}
		c.CreatedAt = createdAt.UTC()
		if eventID.Valid {
			c.EventID = &eventID.Int64
		}
		if userID.Valid {
			c.UserID = &userID.String
		}
		comments = append(comments, c)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return comments, total, nil
}

// GetComment returns a comment by ID scoped to (fingerprint, cluster).
func (s *Store) GetComment(fingerprint, clusterName string, id int64) (*models.Comment, error) {
	var c models.Comment
	var eventID sql.NullInt64
	var userID sql.NullString
	var createdAt time.Time
	err := s.queryRow(context.Background(), `
		SELECT id, fingerprint, cluster_name, event_id, user_id, author_name, body, created_at
		FROM alert_comments
		WHERE fingerprint = ? AND cluster_name = ? AND id = ?
	`, fingerprint, clusterName, id).Scan(&c.ID, &c.Fingerprint, &c.ClusterName, &eventID, &userID, &c.AuthorName, &c.Body, &createdAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get comment: %w", err)
	}
	c.CreatedAt = createdAt.UTC()
	if eventID.Valid {
		c.EventID = &eventID.Int64
	}
	if userID.Valid {
		c.UserID = &userID.String
	}
	return &c, nil
}

// AddComment inserts a new comment.
// userID is nil when the server runs in auth-mode "none".
func (s *Store) AddComment(fingerprint, clusterName string, eventID *int64, userID *string, authorName, body string) (*models.Comment, error) {
	now := time.Now().UTC()
	id, err := s.insertReturningID(context.Background(), `
		INSERT INTO alert_comments (fingerprint, cluster_name, event_id, user_id, author_name, body, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, fingerprint, clusterName, eventID, userID, authorName, body, now)
	if err != nil {
		return nil, fmt.Errorf("insert comment: %w", err)
	}
	return &models.Comment{
		ID:          id,
		Fingerprint: fingerprint,
		ClusterName: clusterName,
		EventID:     eventID,
		UserID:      userID,
		AuthorName:  authorName,
		Body:        body,
		CreatedAt:   now,
	}, nil
}

// DeleteComment deletes a comment by ID scoped to the given (fingerprint, cluster).
// Returns false if no row matched (ID not found or scope mismatch).
// Fingerprint+cluster scope prevents cross-alert/cluster IDOR: callers cannot delete
// a comment that belongs to a different alert scope by guessing sequential IDs.
func (s *Store) DeleteComment(id int64, fingerprint, clusterName string) (bool, error) {
	res, err := s.exec(context.Background(),
		`DELETE FROM alert_comments WHERE id = ? AND fingerprint = ? AND cluster_name = ?`,
		id, fingerprint, clusterName,
	)
	if err != nil {
		return false, fmt.Errorf("delete comment: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// ── Claims ────────────────────────────────────────────────────────────────────

// ClaimKey uniquely identifies a claimable alert. The Alertmanager fingerprint
// alone is not unique across clusters: the same alert mirrored in two clusters
// shares one fingerprint, so claims must additionally be scoped by cluster.
type ClaimKey struct {
	Fingerprint string
	ClusterName string
}

// GetActiveClaim returns the active (unreleased) claim for a (fingerprint,
// cluster) pair, or nil.
func (s *Store) GetActiveClaim(fingerprint, clusterName string) (*models.Claim, error) {
	var c models.Claim
	var eventID sql.NullInt64
	var claimedAt time.Time
	err := s.queryRow(context.Background(), `
		SELECT id, fingerprint, cluster_name, event_id, claimed_by, claimed_at, note
		FROM alert_claims WHERE fingerprint = ? AND cluster_name = ? AND released_at IS NULL
		ORDER BY claimed_at DESC LIMIT 1
	`, fingerprint, clusterName).Scan(&c.ID, &c.Fingerprint, &c.ClusterName, &eventID, &c.ClaimedBy, &claimedAt, &c.Note)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get active claim: %w", err)
	}
	c.ClaimedAt = claimedAt.UTC()
	if eventID.Valid {
		c.EventID = &eventID.Int64
	}
	return &c, nil
}

// GetActiveClaims returns the most recent active (unreleased) claim for every
// (fingerprint, cluster) pair that currently has one, keyed by ClaimKey. It is
// the batched equivalent of calling GetActiveClaim for each alert and exists to
// avoid an N+1 query pattern in the poll loop, where one query per alert would
// otherwise be issued against the single SQLite writer connection.
func (s *Store) GetActiveClaims() (map[ClaimKey]*models.Claim, error) {
	rows, err := s.query(context.Background(), `
		SELECT id, fingerprint, cluster_name, event_id, claimed_by, claimed_at, note
		FROM alert_claims WHERE released_at IS NULL
		ORDER BY claimed_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("get active claims: %w", err)
	}
	defer func() { _ = rows.Close() }()

	result := make(map[ClaimKey]*models.Claim)
	for rows.Next() {
		var c models.Claim
		var eventID sql.NullInt64
		var claimedAt time.Time
		if err := rows.Scan(&c.ID, &c.Fingerprint, &c.ClusterName, &eventID, &c.ClaimedBy, &claimedAt, &c.Note); err != nil {
			return nil, fmt.Errorf("scan active claim: %w", err)
		}
		key := ClaimKey{Fingerprint: c.Fingerprint, ClusterName: c.ClusterName}
		// Rows are ordered newest-first, so the first row seen for a key is its
		// most recent active claim — matching GetActiveClaim's semantics.
		if _, exists := result[key]; exists {
			continue
		}
		c.ClaimedAt = claimedAt.UTC()
		if eventID.Valid {
			c.EventID = &eventID.Int64
		}
		claim := c
		result[key] = &claim
	}
	return result, rows.Err()
}

// SetClaim sets an active claim for a (fingerprint, cluster) pair, releasing any
// existing active claim for that same pair (reclaim).
func (s *Store) SetClaim(fingerprint, clusterName string, eventID *int64, claimedBy, note string) (*models.Claim, error) {
	now := time.Now().UTC()
	// Release existing active claims for this exact alert (fingerprint + cluster).
	_, err := s.exec(context.Background(), `
		UPDATE alert_claims SET released_at = ?, released_by = 'system', release_reason = ?
		WHERE fingerprint = ? AND cluster_name = ? AND released_at IS NULL
	`, now, models.ReleaseReasonReclaimed, fingerprint, clusterName)
	if err != nil {
		return nil, fmt.Errorf("release existing claims: %w", err)
	}

	id, err := s.insertReturningID(context.Background(), `
		INSERT INTO alert_claims (fingerprint, cluster_name, event_id, claimed_by, claimed_at, note)
		VALUES (?, ?, ?, ?, ?, ?)
	`, fingerprint, clusterName, eventID, claimedBy, now, note)
	if err != nil {
		return nil, fmt.Errorf("insert claim: %w", err)
	}
	return &models.Claim{
		ID:          id,
		Fingerprint: fingerprint,
		ClusterName: clusterName,
		EventID:     eventID,
		ClaimedBy:   claimedBy,
		ClaimedAt:   now,
		Note:        note,
	}, nil
}

// UpdateClaimNote lets the current owner change the note of the active claim.
// To keep the claim history append-only and immutable, this does not mutate the
// existing row: it releases the current claim with reason note_updated and
// inserts a fresh claim row (same owner, same event) carrying the new note. The
// previous note therefore remains preserved as an immutable history entry.
// Returns ErrNoActiveClaim if nothing is claimed and ErrNotClaimOwner if by is
// not the current claimant.
func (s *Store) UpdateClaimNote(fingerprint, clusterName, by, note string) (*models.Claim, error) {
	active, err := s.GetActiveClaim(fingerprint, clusterName)
	if err != nil {
		return nil, err
	}
	if active == nil {
		return nil, ErrNoActiveClaim
	}
	if active.ClaimedBy != by {
		return nil, ErrNotClaimOwner
	}

	now := time.Now().UTC()
	if _, err := s.exec(context.Background(), `
		UPDATE alert_claims SET released_at = ?, released_by = ?, release_reason = ?
		WHERE id = ? AND released_at IS NULL
	`, now, by, models.ReleaseReasonNoteUpdated, active.ID); err != nil {
		return nil, fmt.Errorf("release claim for note update: %w", err)
	}

	id, err := s.insertReturningID(context.Background(), `
		INSERT INTO alert_claims (fingerprint, cluster_name, event_id, claimed_by, claimed_at, note)
		VALUES (?, ?, ?, ?, ?, ?)
	`, fingerprint, clusterName, active.EventID, by, now, note)
	if err != nil {
		return nil, fmt.Errorf("insert updated claim: %w", err)
	}

	return &models.Claim{
		ID:          id,
		Fingerprint: fingerprint,
		ClusterName: clusterName,
		EventID:     active.EventID,
		ClaimedBy:   by,
		ClaimedAt:   now,
		Note:        note,
	}, nil
}

// ReleaseClaim releases the active claim for a (fingerprint, cluster) pair.
// Returns false if no active claim was found.
func (s *Store) ReleaseClaim(fingerprint, clusterName, releasedBy, reason string) (bool, error) {
	now := time.Now().UTC()
	res, err := s.exec(context.Background(), `
		UPDATE alert_claims SET released_at = ?, released_by = ?, release_reason = ?
		WHERE fingerprint = ? AND cluster_name = ? AND released_at IS NULL
	`, now, releasedBy, reason, fingerprint, clusterName)
	if err != nil {
		return false, fmt.Errorf("release claim: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// GetClaimHistory returns all claims for a (fingerprint, cluster) pair (newest first).
func (s *Store) GetClaimHistory(fingerprint, clusterName string) ([]models.Claim, error) {
	rows, err := s.query(context.Background(), `
		SELECT id, fingerprint, cluster_name, event_id, claimed_by, claimed_at, note, released_at, released_by, release_reason
		FROM alert_claims WHERE fingerprint = ? AND cluster_name = ?
		ORDER BY claimed_at DESC
	`, fingerprint, clusterName)
	if err != nil {
		return nil, fmt.Errorf("query claims: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var claims []models.Claim
	for rows.Next() {
		var c models.Claim
		var eventID sql.NullInt64
		var claimedAt time.Time
		var releasedAt sql.NullTime
		var releasedBy, releaseReason sql.NullString
		if err := rows.Scan(&c.ID, &c.Fingerprint, &c.ClusterName, &eventID, &c.ClaimedBy, &claimedAt,
			&c.Note, &releasedAt, &releasedBy, &releaseReason); err != nil {
			return nil, fmt.Errorf("scan claim: %w", err)
		}
		c.ClaimedAt = claimedAt.UTC()
		if eventID.Valid {
			c.EventID = &eventID.Int64
		}
		if releasedAt.Valid {
			t := releasedAt.Time.UTC()
			c.ReleasedAt = &t
		}
		if releasedBy.Valid {
			c.ReleasedBy = releasedBy.String
		}
		if releaseReason.Valid {
			c.ReleaseReason = releaseReason.String
		}
		claims = append(claims, c)
	}
	return claims, rows.Err()
}

// ReleaseClaimsForResolved bulk-releases active claims for resolved alerts.
func (s *Store) ReleaseClaimsForResolved(fingerprints []string) error {
	if len(fingerprints) == 0 {
		return nil
	}
	now := time.Now().UTC()
	args := []interface{}{now, "system", models.ReleaseReasonResolved}
	placeholders := ""
	for i, fp := range fingerprints {
		if i > 0 {
			placeholders += ","
		}
		placeholders += "?"
		args = append(args, fp)
	}
	_, err := s.exec(context.Background(), // #nosec G202 -- placeholders are ? params, not user input
		`UPDATE alert_claims SET released_at = ?, released_by = ?, release_reason = ?
		 WHERE released_at IS NULL AND fingerprint IN (`+placeholders+`)`,
		args...,
	)
	return err
}

func (s *Store) ReleaseClaimsForResolvedInCluster(fingerprint, clusterName string) error {
	now := time.Now().UTC()
	_, err := s.exec(context.Background(), `
		UPDATE alert_claims SET released_at = ?, released_by = ?, release_reason = ?
		WHERE released_at IS NULL AND fingerprint = ? AND cluster_name = ?
	`, now, "system", models.ReleaseReasonResolved, fingerprint, clusterName)
	return err
}

// IsStillResolved reports whether the most recent event for the fingerprint is
// still "resolved". Guards the delayed claim release against grace-period
// re-fires that rolled back the resolved row before the delay elapsed.
func (s *Store) IsStillResolved(fingerprint string) (bool, error) {
	return s.IsStillResolvedForCluster(fingerprint, "")
}

func (s *Store) IsStillResolvedForCluster(fingerprint, clusterName string) (bool, error) {
	last, err := s.getLastEventForCluster(fingerprint, clusterName)
	if err != nil || last == nil {
		return false, err
	}
	return last.Status == models.EventStatusResolved, nil
}

// ── Silence Events ────────────────────────────────────────────────────────────

// RecordSilenceEvent persists a user-triggered silence action.
func (s *Store) RecordSilenceEvent(fingerprint, silenceID, clusterName, action, performedBy, comment string) (*models.SilenceEvent, error) {
	now := time.Now().UTC()
	id, err := s.insertReturningID(context.Background(), `
		INSERT INTO silence_events (fingerprint, silence_id, cluster_name, action, performed_by, comment, recorded_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, fingerprint, silenceID, clusterName, action, performedBy, comment, now)
	if err != nil {
		return nil, fmt.Errorf("insert silence event: %w", err)
	}
	return &models.SilenceEvent{
		ID:          id,
		Fingerprint: fingerprint,
		SilenceID:   silenceID,
		ClusterName: clusterName,
		Action:      action,
		PerformedBy: performedBy,
		Comment:     comment,
		RecordedAt:  now,
	}, nil
}

// HasSilenceEventsForSilenceID reports whether any silence_events row exists for the given silenceID.
func (s *Store) HasSilenceEventsForSilenceID(silenceID string) (bool, error) {
	return s.HasSilenceEventsForSilenceIDInCluster(silenceID, "")
}

func (s *Store) HasSilenceEventsForSilenceIDInCluster(silenceID, clusterName string) (bool, error) {
	var count int
	query := `SELECT COUNT(*) FROM silence_events WHERE silence_id = ?`
	args := []interface{}{silenceID}
	if clusterName != "" {
		query += ` AND cluster_name = ?`
		args = append(args, clusterName)
	}
	err := s.queryRow(context.Background(), query, args...).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("count silence events by silence_id: %w", err)
	}
	return count > 0, nil
}

// GetSilenceEvents returns all silence events for a fingerprint (newest first).
func (s *Store) GetSilenceEvents(fingerprint string) ([]models.SilenceEvent, error) {
	return s.GetSilenceEventsForCluster(fingerprint, "")
}

// GetSilenceEventsForCluster returns silence events for a fingerprint,
// optionally scoped to one cluster.
func (s *Store) GetSilenceEventsForCluster(fingerprint, clusterName string) ([]models.SilenceEvent, error) {
	query := `
		SELECT id, fingerprint, silence_id, cluster_name, action, performed_by, comment, recorded_at
		FROM silence_events
		WHERE fingerprint = ?
	`
	args := []interface{}{fingerprint}
	if clusterName != "" {
		query += ` AND cluster_name = ?`
		args = append(args, clusterName)
	}
	query += ` ORDER BY recorded_at DESC`

	rows, err := s.query(context.Background(), query, args...)
	if err != nil {
		return nil, fmt.Errorf("query silence events: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var events []models.SilenceEvent
	for rows.Next() {
		var e models.SilenceEvent
		var recordedAt time.Time
		if err := rows.Scan(&e.ID, &e.Fingerprint, &e.SilenceID, &e.ClusterName,
			&e.Action, &e.PerformedBy, &e.Comment, &recordedAt); err != nil {
			return nil, fmt.Errorf("scan silence event: %w", err)
		}
		e.RecordedAt = recordedAt.UTC()
		events = append(events, e)
	}
	return events, rows.Err()
}

// ── Internal helpers ──────────────────────────────────────────────────────────

func (s *Store) getLastEventForCluster(fingerprint, clusterName string) (*models.AlertEvent, error) {
	return s.getLastEventForClusterOn(s.db, context.Background(), fingerprint, clusterName)
}

func (s *Store) getLastEventForClusterOn(q queryer, ctx context.Context, fingerprint, clusterName string) (*models.AlertEvent, error) {
	var e models.AlertEvent
	var startsAt, recordedAt time.Time
	var endsAt sql.NullTime
	clusterFilter := ""
	args := []interface{}{fingerprint}
	if clusterName != "" {
		clusterFilter = " AND cluster_name = ?"
		args = append(args, clusterName)
	}
	err := s.queryRowOn(q, ctx, `
		SELECT id, fingerprint, cluster_name, alertmanager_url, status, starts_at, ends_at, recorded_at
		FROM alert_events WHERE fingerprint = ?`+clusterFilter+`
		ORDER BY recorded_at DESC LIMIT 1
	`, args...).Scan(&e.ID, &e.Fingerprint, &e.ClusterName, &e.AlertmanagerURL,
		&e.Status, &startsAt, &endsAt, &recordedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	e.StartsAt = startsAt.UTC()
	e.RecordedAt = recordedAt.UTC()
	if endsAt.Valid {
		t := endsAt.Time.UTC()
		e.EndsAt = &t
	}
	return &e, nil
}

// scanResolvedAlerts reads all rows from a resolved-alert query into EnrichedAlert values.
// Expected columns: fingerprint, cluster_name, alertmanager_url, starts_at, recorded_at, annotations, labels.
func scanResolvedAlerts(rows *sql.Rows) ([]models.EnrichedAlert, error) {
	alerts := make([]models.EnrichedAlert, 0)
	for rows.Next() {
		var fp, clusterName, amURL, labelsJSON string
		var annotationsJSON sql.NullString
		var startsAt, resolvedAt time.Time
		if err := rows.Scan(&fp, &clusterName, &amURL, &startsAt, &resolvedAt, &annotationsJSON, &labelsJSON); err != nil {
			return nil, fmt.Errorf("scan resolved alert: %w", err)
		}
		var labels map[string]string
		if err := json.Unmarshal([]byte(labelsJSON), &labels); err != nil {
			labels = map[string]string{}
		}
		var annotations map[string]string
		if annotationsJSON.Valid {
			if err := json.Unmarshal([]byte(annotationsJSON.String), &annotations); err != nil {
				annotations = map[string]string{}
			}
		}
		if annotations == nil {
			annotations = map[string]string{}
		}
		// Restore receivers from the @receiver label that was saved at index time.
		// @receiver is stored as comma-separated list of receiver names.
		receivers := []models.Receiver{}
		if receiverNames := labels["@receiver"]; receiverNames != "" {
			for _, name := range strings.Split(receiverNames, ",") {
				if trimmed := strings.TrimSpace(name); trimmed != "" {
					receivers = append(receivers, models.Receiver{Name: trimmed})
				}
			}
		}
		alerts = append(alerts, models.EnrichedAlert{
			Fingerprint: fp,
			Status: models.AlertStatus{
				State:       "resolved",
				InhibitedBy: []string{},
				SilencedBy:  []string{},
			},
			Labels:          labels,
			Annotations:     annotations,
			StartsAt:        startsAt.UTC(),
			EndsAt:          resolvedAt.UTC(),
			UpdatedAt:       resolvedAt.UTC(),
			Receivers:       receivers,
			ClusterName:     clusterName,
			AlertmanagerURL: amURL,
		})
	}
	return alerts, rows.Err()
}

// GetAllResolved returns one EnrichedAlert per fingerprint for every alert whose
// most recent event is 'resolved'. Alerts that have since re-fired are excluded
// because their latest event will be 'firing' or 'suppressed'.
func (s *Store) GetAllResolved() ([]models.EnrichedAlert, error) {
	rows, err := s.query(context.Background(), `
		WITH latest AS (
			SELECT fingerprint, cluster_name, MAX(id) AS max_id
			FROM alert_events
			GROUP BY fingerprint, cluster_name
		)
		SELECT e.fingerprint, e.cluster_name, e.alertmanager_url, e.starts_at, e.recorded_at, e.annotations, f.labels
		FROM alert_events e
		JOIN latest ON e.id = latest.max_id
		JOIN alert_fingerprints f ON f.fingerprint = e.fingerprint
		WHERE e.status = 'resolved'
		ORDER BY e.recorded_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("get all resolved: %w", err)
	}
	defer func() { _ = rows.Close() }()
	return scanResolvedAlerts(rows)
}

// GetRecentResolved returns one EnrichedAlert per fingerprint for all alerts
// that were resolved within the given window (using recorded_at of the resolved event).
// Used to seed the in-memory AlertStore on startup so resolved alerts survive restarts.
func (s *Store) GetRecentResolved(window time.Duration) ([]models.EnrichedAlert, error) {
	since := time.Now().UTC().Add(-window)
	rows, err := s.query(context.Background(), `
		SELECT e.fingerprint, e.cluster_name, e.alertmanager_url, e.starts_at, e.recorded_at, e.annotations, f.labels
		FROM alert_events e
		JOIN alert_fingerprints f ON f.fingerprint = e.fingerprint
		WHERE e.status = 'resolved'
		  AND e.id IN (
		    SELECT MAX(id) FROM alert_events
		    WHERE status = 'resolved' AND recorded_at >= ?
		    GROUP BY fingerprint, cluster_name
		  )
		ORDER BY e.recorded_at DESC
	`, since)
	if err != nil {
		return nil, fmt.Errorf("get recent resolved: %w", err)
	}
	defer func() { _ = rows.Close() }()
	return scanResolvedAlerts(rows)
}

// ── Silence Templates ─────────────────────────────────────────────────────────

// CreateSilenceTemplate inserts a new silence template.
func (s *Store) CreateSilenceTemplate(id, name string, matchers []models.SilenceMatcher, reason string) (*models.SilenceTemplate, error) {
	matchersJSON, err := json.Marshal(matchers)
	if err != nil {
		return nil, fmt.Errorf("marshal matchers: %w", err)
	}
	now := time.Now().UTC()
	_, err = s.exec(context.Background(), `
		INSERT INTO silence_templates (id, name, matchers, reason, created_at)
		VALUES (?, ?, ?, ?, ?)
	`, id, name, string(matchersJSON), reason, now)
	if err != nil {
		return nil, fmt.Errorf("insert silence template: %w", err)
	}
	return &models.SilenceTemplate{
		ID:        id,
		Name:      name,
		Matchers:  matchers,
		Reason:    reason,
		CreatedAt: now,
	}, nil
}

// GetAllSilenceTemplates returns all silence templates, ordered by creation time (newest first).
func (s *Store) GetAllSilenceTemplates() ([]models.SilenceTemplate, error) {
	rows, err := s.query(context.Background(), `
		SELECT id, name, matchers, reason, created_at
		FROM silence_templates
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("query silence templates: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var templates []models.SilenceTemplate
	for rows.Next() {
		var t models.SilenceTemplate
		var matchersJSON string
		var createdAt time.Time
		if err := rows.Scan(&t.ID, &t.Name, &matchersJSON, &t.Reason, &createdAt); err != nil {
			return nil, fmt.Errorf("scan silence template: %w", err)
		}
		if err := json.Unmarshal([]byte(matchersJSON), &t.Matchers); err != nil {
			t.Matchers = []models.SilenceMatcher{}
		}
		t.CreatedAt = createdAt.UTC()
		templates = append(templates, t)
	}
	return templates, rows.Err()
}

// DeleteSilenceTemplate deletes a silence template by ID.
func (s *Store) DeleteSilenceTemplate(id string) error {
	_, err := s.exec(context.Background(), `
		DELETE FROM silence_templates WHERE id = ?
	`, id)
	if err != nil {
		return fmt.Errorf("delete silence template: %w", err)
	}
	return nil
}

// UpdateSilenceTemplate updates a silence template.
func (s *Store) UpdateSilenceTemplate(id, name string, matchers []models.SilenceMatcher, reason string) (*models.SilenceTemplate, error) {
	matchersJSON, err := json.Marshal(matchers)
	if err != nil {
		return nil, fmt.Errorf("marshal matchers: %w", err)
	}
	_, err = s.exec(context.Background(), `
		UPDATE silence_templates
		SET name = ?, matchers = ?, reason = ?
		WHERE id = ?
	`, name, string(matchersJSON), reason, id)
	if err != nil {
		return nil, fmt.Errorf("update silence template: %w", err)
	}
	return &models.SilenceTemplate{
		ID:       id,
		Name:     name,
		Matchers: matchers,
		Reason:   reason,
	}, nil
}
