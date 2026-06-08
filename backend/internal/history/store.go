package history

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/kj187/jarvis/backend/internal/models"
)

// Store handles all SQLite persistence for alerts.
type Store struct {
	db *sql.DB
}

// NewStore creates a new Store with the given database connection.
func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// ── Fingerprints ──────────────────────────────────────────────────────────────

// UpsertFingerprint inserts or updates an alert fingerprint record.
func (s *Store) UpsertFingerprint(fingerprint, alertname, clusterName string, labels map[string]string) error {
	labelsJSON, err := json.Marshal(labels)
	if err != nil {
		return fmt.Errorf("marshal labels: %w", err)
	}
	now := time.Now().UTC()
	_, err = s.db.Exec(`
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
			if _, err := s.db.Exec(`DELETE FROM alert_events WHERE id = ?`, last.ID); err != nil {
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
	res, err := s.db.Exec(`
		INSERT INTO alert_events (fingerprint, cluster_name, alertmanager_url, status, starts_at, annotations, recorded_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, fingerprint, clusterName, amURL, status, startsAt.UTC(), string(annJSON), now)
	if err != nil {
		return nil, fmt.Errorf("insert status change: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("last insert id: %w", err)
	}

	// Increment occurrence_count only on genuine re-fire after full resolution.
	if status == models.EventStatusFiring && lastStatus == models.EventStatusResolved {
		if _, err := s.db.Exec(
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
	_, err = s.db.Exec(`
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
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM alert_events WHERE fingerprint = ?`, fingerprint).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count events: %w", err)
	}

	rows, err := s.db.Query(`
		SELECT id, fingerprint, cluster_name, alertmanager_url, status, starts_at, ends_at, annotations, recorded_at
		FROM alert_events
		WHERE fingerprint = ?
		ORDER BY recorded_at DESC
		LIMIT ? OFFSET ?
	`, fingerprint, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("query events: %w", err)
	}
	defer rows.Close()

	var events []models.AlertEvent
	for rows.Next() {
		var e models.AlertEvent
		var endsAt sql.NullTime
		var startsAt, recordedAt time.Time
		if err := rows.Scan(&e.ID, &e.Fingerprint, &e.ClusterName, &e.AlertmanagerURL,
			&e.Status, &startsAt, &endsAt, &e.Annotations, &recordedAt); err != nil {
			return nil, 0, fmt.Errorf("scan event: %w", err)
		}
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

// GetStats returns occurrence statistics for a fingerprint.
func (s *Store) GetStats(fingerprint string) (*models.AlertStats, error) {
	var st models.AlertStats
	err := s.db.QueryRow(`
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
	return &st, nil
}

// ── Comments ──────────────────────────────────────────────────────────────────

// GetComments returns all comments for a fingerprint (newest first).
func (s *Store) GetComments(fingerprint string) ([]models.Comment, error) {
	rows, err := s.db.Query(`
		SELECT id, fingerprint, event_id, author_name, body, created_at
		FROM alert_comments WHERE fingerprint = ?
		ORDER BY created_at DESC
	`, fingerprint)
	if err != nil {
		return nil, fmt.Errorf("query comments: %w", err)
	}
	defer rows.Close()

	var comments []models.Comment
	for rows.Next() {
		var c models.Comment
		var eventID sql.NullInt64
		var createdAt time.Time
		if err := rows.Scan(&c.ID, &c.Fingerprint, &eventID, &c.AuthorName, &c.Body, &createdAt); err != nil {
			return nil, fmt.Errorf("scan comment: %w", err)
		}
		c.CreatedAt = createdAt.UTC()
		if eventID.Valid {
			c.EventID = &eventID.Int64
		}
		comments = append(comments, c)
	}
	return comments, rows.Err()
}

// AddComment inserts a new comment.
func (s *Store) AddComment(fingerprint string, eventID *int64, authorName, body string) (*models.Comment, error) {
	now := time.Now().UTC()
	res, err := s.db.Exec(`
		INSERT INTO alert_comments (fingerprint, event_id, author_name, body, created_at)
		VALUES (?, ?, ?, ?, ?)
	`, fingerprint, eventID, authorName, body, now)
	if err != nil {
		return nil, fmt.Errorf("insert comment: %w", err)
	}
	id, _ := res.LastInsertId()
	return &models.Comment{
		ID:          id,
		Fingerprint: fingerprint,
		EventID:     eventID,
		AuthorName:  authorName,
		Body:        body,
		CreatedAt:   now,
	}, nil
}

// DeleteComment deletes a comment by ID. Returns false if no row was deleted.
func (s *Store) DeleteComment(id int64) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM alert_comments WHERE id = ?`, id)
	if err != nil {
		return false, fmt.Errorf("delete comment: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// ── Claims ────────────────────────────────────────────────────────────────────

// GetActiveClaim returns the active (unreleased) claim for a fingerprint, or nil.
func (s *Store) GetActiveClaim(fingerprint string) (*models.Claim, error) {
	var c models.Claim
	var eventID sql.NullInt64
	var claimedAt time.Time
	err := s.db.QueryRow(`
		SELECT id, fingerprint, event_id, claimed_by, claimed_at, note
		FROM alert_claims WHERE fingerprint = ? AND released_at IS NULL
		ORDER BY claimed_at DESC LIMIT 1
	`, fingerprint).Scan(&c.ID, &c.Fingerprint, &eventID, &c.ClaimedBy, &claimedAt, &c.Note)
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

// SetClaim releases any existing active claim (reason: reclaimed) and creates a
// new one.
func (s *Store) SetClaim(fingerprint string, eventID *int64, claimedBy, note string) (*models.Claim, error) {
	now := time.Now().UTC()
	// Release existing active claims.
	_, err := s.db.Exec(`
		UPDATE alert_claims SET released_at = ?, released_by = 'system', release_reason = ?
		WHERE fingerprint = ? AND released_at IS NULL
	`, now, models.ReleaseReasonReclaimed, fingerprint)
	if err != nil {
		return nil, fmt.Errorf("release existing claims: %w", err)
	}

	res, err := s.db.Exec(`
		INSERT INTO alert_claims (fingerprint, event_id, claimed_by, claimed_at, note)
		VALUES (?, ?, ?, ?, ?)
	`, fingerprint, eventID, claimedBy, now, note)
	if err != nil {
		return nil, fmt.Errorf("insert claim: %w", err)
	}
	id, _ := res.LastInsertId()
	return &models.Claim{
		ID:          id,
		Fingerprint: fingerprint,
		EventID:     eventID,
		ClaimedBy:   claimedBy,
		ClaimedAt:   now,
		Note:        note,
	}, nil
}

// ReleaseClaim releases the active claim for a fingerprint. Returns false if no
// active claim was found.
func (s *Store) ReleaseClaim(fingerprint, releasedBy, reason string) (bool, error) {
	now := time.Now().UTC()
	res, err := s.db.Exec(`
		UPDATE alert_claims SET released_at = ?, released_by = ?, release_reason = ?
		WHERE fingerprint = ? AND released_at IS NULL
	`, now, releasedBy, reason, fingerprint)
	if err != nil {
		return false, fmt.Errorf("release claim: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// GetClaimHistory returns all claims for a fingerprint (newest first).
func (s *Store) GetClaimHistory(fingerprint string) ([]models.Claim, error) {
	rows, err := s.db.Query(`
		SELECT id, fingerprint, event_id, claimed_by, claimed_at, note, released_at, released_by, release_reason
		FROM alert_claims WHERE fingerprint = ?
		ORDER BY claimed_at DESC
	`, fingerprint)
	if err != nil {
		return nil, fmt.Errorf("query claims: %w", err)
	}
	defer rows.Close()

	var claims []models.Claim
	for rows.Next() {
		var c models.Claim
		var eventID sql.NullInt64
		var claimedAt time.Time
		var releasedAt sql.NullTime
		var releasedBy, releaseReason sql.NullString
		if err := rows.Scan(&c.ID, &c.Fingerprint, &eventID, &c.ClaimedBy, &claimedAt,
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
	_, err := s.db.Exec( // #nosec G202 -- placeholders are ? params, not user input
		`UPDATE alert_claims SET released_at = ?, released_by = ?, release_reason = ?
		 WHERE released_at IS NULL AND fingerprint IN (`+placeholders+`)`,
		args...,
	)
	return err
}

// ── Silence Events ────────────────────────────────────────────────────────────

// RecordSilenceEvent persists a user-triggered silence action.
func (s *Store) RecordSilenceEvent(fingerprint, silenceID, clusterName, action, performedBy, comment string) (*models.SilenceEvent, error) {
	now := time.Now().UTC()
	res, err := s.db.Exec(`
		INSERT INTO silence_events (fingerprint, silence_id, cluster_name, action, performed_by, comment, recorded_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, fingerprint, silenceID, clusterName, action, performedBy, comment, now)
	if err != nil {
		return nil, fmt.Errorf("insert silence event: %w", err)
	}
	id, _ := res.LastInsertId()
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

// GetSilenceEvents returns all silence events for a fingerprint (newest first).
func (s *Store) GetSilenceEvents(fingerprint string) ([]models.SilenceEvent, error) {
	rows, err := s.db.Query(`
		SELECT id, fingerprint, silence_id, cluster_name, action, performed_by, comment, recorded_at
		FROM silence_events WHERE fingerprint = ?
		ORDER BY recorded_at DESC
	`, fingerprint)
	if err != nil {
		return nil, fmt.Errorf("query silence events: %w", err)
	}
	defer rows.Close()

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

// getLastEvent returns the most recent event for a fingerprint ordered by recorded_at.
func (s *Store) getLastEvent(fingerprint string) (*models.AlertEvent, error) {
	var e models.AlertEvent
	var startsAt, recordedAt time.Time
	var endsAt sql.NullTime
	err := s.db.QueryRow(`
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
