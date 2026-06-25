package history

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/models"
)

// Store handles all database persistence for alerts.
type Store struct {
	db      *sql.DB
	dialect idb.Dialect
}

// NewStore creates a new Store with the given database connection and dialect.
func NewStore(database *sql.DB, dialect idb.Dialect) *Store {
	return &Store{db: database, dialect: dialect}
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

func (s *Store) exec(ctx context.Context, query string, args ...interface{}) (sql.Result, error) {
	return s.db.ExecContext(ctx, rebind(s.dialect, query), args...)
}

func (s *Store) queryRow(ctx context.Context, query string, args ...interface{}) *sql.Row {
	return s.db.QueryRowContext(ctx, rebind(s.dialect, query), args...)
}

func (s *Store) query(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error) {
	return s.db.QueryContext(ctx, rebind(s.dialect, query), args...)
}

// insertReturningID executes an INSERT and returns the new row ID.
// PostgreSQL: appends RETURNING id and uses QueryRowContext.
// SQLite: uses ExecContext + LastInsertId.
func (s *Store) insertReturningID(ctx context.Context, query string, args ...interface{}) (int64, error) {
	q := rebind(s.dialect, query)
	if s.dialect == idb.DialectPostgres {
		var id int64
		if err := s.db.QueryRowContext(ctx, q+" RETURNING id", args...).Scan(&id); err != nil {
			return 0, err
		}
		return id, nil
	}
	res, err := s.db.ExecContext(ctx, q, args...)
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
// Grace Period (60s): if the alert re-fires within 60 s of a resolved row, that
// resolved row is deleted and the prior firing row is returned — no new insert.
// occurrence_count is incremented only when re-firing after a full resolution.
func (s *Store) RecordStatusChange(
	fingerprint, clusterName, amURL, status string,
	startsAt time.Time,
	annotations map[string]string,
) (*models.AlertEvent, error) {
	last, err := s.getLastEvent(fingerprint)
	if err != nil {
		return nil, err
	}

	// Idempotency: same status → return existing row unchanged.
	if last != nil && last.Status == status {
		return last, nil
	}

	lastStatus := ""
	if last != nil {
		lastStatus = last.Status
	}

	// Grace Period: alert re-fires within 60 s of resolved → discard resolved row.
	if status == models.EventStatusFiring && lastStatus == models.EventStatusResolved {
		if time.Since(last.RecordedAt) < 60*time.Second {
			if _, err := s.exec(context.Background(), `DELETE FROM alert_events WHERE id = ?`, last.ID); err != nil {
				return nil, fmt.Errorf("grace period delete resolved: %w", err)
			}
			prev, err := s.getLastEvent(fingerprint)
			if err != nil {
				return nil, err
			}
			if prev != nil {
				return prev, nil
			}
			// No prior row after deletion — fall through to insert a fresh firing row.
			// Reset lastStatus so occurrence_count is not incremented.
			lastStatus = ""
		}
	}

	annJSON, err := json.Marshal(annotations)
	if err != nil {
		return nil, fmt.Errorf("marshal annotations: %w", err)
	}
	now := time.Now().UTC()
	id, err := s.insertReturningID(context.Background(), `
		INSERT INTO alert_events (fingerprint, cluster_name, alertmanager_url, status, starts_at, annotations, recorded_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, fingerprint, clusterName, amURL, status, startsAt.UTC(), string(annJSON), now)
	if err != nil {
		return nil, fmt.Errorf("insert status change: %w", err)
	}

	// Increment occurrence_count only on genuine re-fire after full resolution.
	if status == models.EventStatusFiring && lastStatus == models.EventStatusResolved {
		if _, err := s.exec(context.Background(),
			`UPDATE alert_fingerprints SET occurrence_count = occurrence_count + 1 WHERE fingerprint = ?`,
			fingerprint,
		); err != nil {
			return nil, fmt.Errorf("increment occurrence_count: %w", err)
		}
	}

	return &models.AlertEvent{
		ID:              id,
		Fingerprint:     fingerprint,
		ClusterName:     clusterName,
		AlertmanagerURL: amURL,
		Status:          status,
		StartsAt:        startsAt.UTC(),
		RecordedAt:      now,
	}, nil
}

// RecordResolved inserts a resolved row for a fingerprint, inheriting cluster
// info and starts_at from the last known event. No-op if already resolved or
// no history exists for this fingerprint.
func (s *Store) RecordResolved(fingerprint string, resolvedAt time.Time) error {
	last, err := s.getLastEvent(fingerprint)
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

// GetHistory returns paginated alert events for a fingerprint (newest first).
func (s *Store) GetHistory(fingerprint string, limit, offset int) ([]models.AlertEvent, int, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	var total int
	if err := s.queryRow(context.Background(),
		`SELECT COUNT(*) FROM alert_events WHERE fingerprint = ?`, fingerprint,
	).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count events: %w", err)
	}

	rows, err := s.query(context.Background(), `
		SELECT id, fingerprint, cluster_name, alertmanager_url, status, starts_at, ends_at, annotations, recorded_at
		FROM alert_events
		WHERE fingerprint = ?
		ORDER BY recorded_at DESC
		LIMIT ? OFFSET ?
	`, fingerprint, limit, offset)
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

	entries := make([]models.AlertTimelineEntry, 0, limit)
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
	var st models.AlertStats
	err := s.queryRow(context.Background(), `
		SELECT fingerprint, alertname, cluster_name, first_seen_at, last_seen_at, occurrence_count
		FROM alert_fingerprints WHERE fingerprint = ?
	`, fingerprint).Scan(&st.Fingerprint, &st.Alertname, &st.ClusterName, &st.FirstSeenAt, &st.LastSeenAt, &st.OccurrenceCount)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get stats: %w", err)
	}
	st.FirstSeenAt = st.FirstSeenAt.UTC()
	st.LastSeenAt = st.LastSeenAt.UTC()

	var resolvedAt sql.NullTime
	_ = s.queryRow(context.Background(), `
		SELECT recorded_at FROM alert_events
		WHERE fingerprint = ? AND status = 'resolved'
		ORDER BY recorded_at DESC LIMIT 1
	`, fingerprint).Scan(&resolvedAt)
	if resolvedAt.Valid {
		t := resolvedAt.Time.UTC()
		st.LastResolvedAt = &t
	}

	return &st, nil
}

// ── Comments ──────────────────────────────────────────────────────────────────

// GetComments returns all comments for a fingerprint (newest first).
func (s *Store) GetComments(fingerprint string) ([]models.Comment, error) {
	rows, err := s.query(context.Background(), `
		SELECT id, fingerprint, event_id, user_id, author_name, body, created_at
		FROM alert_comments WHERE fingerprint = ?
		ORDER BY created_at DESC
	`, fingerprint)
	if err != nil {
		return nil, fmt.Errorf("query comments: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var comments []models.Comment
	for rows.Next() {
		var c models.Comment
		var eventID sql.NullInt64
		var userID sql.NullString
		var createdAt time.Time
		if err := rows.Scan(&c.ID, &c.Fingerprint, &eventID, &userID, &c.AuthorName, &c.Body, &createdAt); err != nil {
			return nil, fmt.Errorf("scan comment: %w", err)
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
	return comments, rows.Err()
}

// GetComment returns a comment by ID scoped to fingerprint.
func (s *Store) GetComment(fingerprint string, id int64) (*models.Comment, error) {
	var c models.Comment
	var eventID sql.NullInt64
	var userID sql.NullString
	var createdAt time.Time
	err := s.queryRow(context.Background(), `
		SELECT id, fingerprint, event_id, user_id, author_name, body, created_at
		FROM alert_comments WHERE fingerprint = ? AND id = ?
	`, fingerprint, id).Scan(&c.ID, &c.Fingerprint, &eventID, &userID, &c.AuthorName, &c.Body, &createdAt)
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
func (s *Store) AddComment(fingerprint string, eventID *int64, userID *string, authorName, body string) (*models.Comment, error) {
	now := time.Now().UTC()
	id, err := s.insertReturningID(context.Background(), `
		INSERT INTO alert_comments (fingerprint, event_id, user_id, author_name, body, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, fingerprint, eventID, userID, authorName, body, now)
	if err != nil {
		return nil, fmt.Errorf("insert comment: %w", err)
	}
	return &models.Comment{
		ID:          id,
		Fingerprint: fingerprint,
		EventID:     eventID,
		UserID:      userID,
		AuthorName:  authorName,
		Body:        body,
		CreatedAt:   now,
	}, nil
}

// DeleteComment deletes a comment by ID scoped to the given fingerprint.
// Returns false if no row matched (either ID not found or fingerprint mismatch).
// The fingerprint scope prevents cross-alert IDOR: callers cannot delete a comment
// that belongs to a different alert by guessing sequential IDs.
func (s *Store) DeleteComment(id int64, fingerprint string) (bool, error) {
	res, err := s.exec(context.Background(), `DELETE FROM alert_comments WHERE id = ? AND fingerprint = ?`, id, fingerprint)
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

// IsStillResolved reports whether the most recent event for the fingerprint is
// still "resolved". Guards the delayed claim release against grace-period
// re-fires that rolled back the resolved row before the delay elapsed.
func (s *Store) IsStillResolved(fingerprint string) (bool, error) {
	last, err := s.getLastEvent(fingerprint)
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
	var count int
	err := s.queryRow(context.Background(), `
		SELECT COUNT(*) FROM silence_events WHERE silence_id = ?
	`, silenceID).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("count silence events by silence_id: %w", err)
	}
	return count > 0, nil
}

// GetSilenceEvents returns all silence events for a fingerprint (newest first).
func (s *Store) GetSilenceEvents(fingerprint string) ([]models.SilenceEvent, error) {
	rows, err := s.query(context.Background(), `
		SELECT id, fingerprint, silence_id, cluster_name, action, performed_by, comment, recorded_at
		FROM silence_events WHERE fingerprint = ?
		ORDER BY recorded_at DESC
	`, fingerprint)
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

func (s *Store) getLastEvent(fingerprint string) (*models.AlertEvent, error) {
	var e models.AlertEvent
	var startsAt, recordedAt time.Time
	var endsAt sql.NullTime
	err := s.queryRow(context.Background(), `
		SELECT id, fingerprint, cluster_name, alertmanager_url, status, starts_at, ends_at, recorded_at
		FROM alert_events WHERE fingerprint = ?
		ORDER BY recorded_at DESC LIMIT 1
	`, fingerprint).Scan(&e.ID, &e.Fingerprint, &e.ClusterName, &e.AlertmanagerURL,
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
			SELECT fingerprint, MAX(id) AS max_id
			FROM alert_events
			GROUP BY fingerprint
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
		    GROUP BY fingerprint
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
