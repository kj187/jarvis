package history

import (
	"context"
	"fmt"
	"time"
)

// sweepableEventsCondition selects alert_events rows (aliased "e") that are
// safe to delete during a retention sweep: either the episode is already
// closed (resolved/expired), or a newer event exists for the same
// (fingerprint, cluster_name) — i.e. this row has been superseded and is no
// longer the open head of a still-firing/suppressed episode.
//
// Deliberately does NOT use ends_at: RecordStatusChange/
// RecordResolvedForCluster never write it (always NULL), so a condition
// built on it would never match anything and old firing/suppressed rows
// would grow unbounded for flapping alerts — exactly what retention is
// meant to prevent. The one row this predicate never matches, regardless of
// age, is the newest row per (fingerprint, cluster_name) while its status is
// firing/suppressed — the open head of a still-active episode, which can
// legitimately be very old since the recorder only writes rows on status
// *changes*.
const sweepableEventsCondition = `
	e.recorded_at < ?
	AND (
		e.status IN ('resolved', 'expired')
		OR EXISTS (
			SELECT 1 FROM alert_events n
			WHERE n.fingerprint = e.fingerprint
			  AND n.cluster_name = e.cluster_name
			  AND (n.recorded_at > e.recorded_at
			       OR (n.recorded_at = e.recorded_at AND n.id > e.id))
		)
	)
`

// batchDeleteLoop repeatedly runs a "DELETE ... WHERE id IN (SELECT ... LIMIT ?)"
// query (the last '?' bound to batch), pausing briefly between batches, until
// a batch affects fewer rows than batch. This keeps one retention sweep from
// holding SQLite's single writer lock (Critical Invariant #8) for one giant
// transaction. Returns early if ctx is cancelled (server shutdown).
func (s *Store) batchDeleteLoop(ctx context.Context, query string, batch int, args ...interface{}) (int64, error) {
	fullArgs := make([]interface{}, len(args)+1)
	copy(fullArgs, args)
	fullArgs[len(args)] = batch

	var total int64
	for {
		select {
		case <-ctx.Done():
			return total, ctx.Err()
		default:
		}

		res, err := s.exec(ctx, query, fullArgs...)
		if err != nil {
			return total, err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return total, err
		}
		total += n
		if n < int64(batch) {
			return total, nil
		}

		select {
		case <-ctx.Done():
			return total, ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
	}
}

// DeleteSweepableEventsBefore deletes alert_events rows matching
// sweepableEventsCondition, older than cutoff, in batches of batch rows. The
// open head of a still-firing/suppressed episode is never deleted,
// regardless of age — see sweepableEventsCondition's doc comment.
func (s *Store) DeleteSweepableEventsBefore(ctx context.Context, cutoff time.Time, batch int) (int64, error) {
	query := `
		DELETE FROM alert_events WHERE id IN (
			SELECT e.id FROM alert_events e
			WHERE ` + sweepableEventsCondition + `
			LIMIT ?
		)
	`
	return s.batchDeleteLoop(ctx, query, batch, cutoff.UTC())
}

// DetachCommentsAndClaimsFromSweepableEventsBefore nulls event_id on every
// alert_comments/alert_claims row that references an event
// DeleteSweepableEventsBefore(cutoff, ...) is about to delete. event_id is
// nullable precisely so a surviving comment/claim never blocks event
// deletion. Must run before DeleteSweepableEventsBefore in the sweep order.
func (s *Store) DetachCommentsAndClaimsFromSweepableEventsBefore(ctx context.Context, cutoff time.Time) (int64, error) {
	var total int64

	commentsRes, err := s.exec(ctx, `
		UPDATE alert_comments SET event_id = NULL WHERE event_id IN (
			SELECT e.id FROM alert_events e WHERE `+sweepableEventsCondition+`
		)
	`, cutoff.UTC())
	if err != nil {
		return total, fmt.Errorf("detach comments from sweepable events: %w", err)
	}
	n, err := commentsRes.RowsAffected()
	if err != nil {
		return total, err
	}
	total += n

	claimsRes, err := s.exec(ctx, `
		UPDATE alert_claims SET event_id = NULL WHERE event_id IN (
			SELECT e.id FROM alert_events e WHERE `+sweepableEventsCondition+`
		)
	`, cutoff.UTC())
	if err != nil {
		return total, fmt.Errorf("detach claims from sweepable events: %w", err)
	}
	n, err = claimsRes.RowsAffected()
	if err != nil {
		return total, err
	}
	total += n

	return total, nil
}

// DeleteReleasedClaimsBefore deletes alert_claims rows released
// (released_at IS NOT NULL) before cutoff, in batches of batch rows. Active
// claims (released_at NULL) are never touched, regardless of age.
func (s *Store) DeleteReleasedClaimsBefore(ctx context.Context, cutoff time.Time, batch int) (int64, error) {
	query := `
		DELETE FROM alert_claims WHERE id IN (
			SELECT id FROM alert_claims
			WHERE released_at IS NOT NULL AND released_at < ?
			LIMIT ?
		)
	`
	return s.batchDeleteLoop(ctx, query, batch, cutoff.UTC())
}

// DeleteCommentsBefore deletes alert_comments rows older than cutoff (by
// created_at), in batches of batch rows. Only invoked by the sweeper when
// JARVIS_RETENTION_COMMENTS_DAYS is explicitly set — comments never inherit
// the global retention (config.RetentionConfig.EffectiveCommentsDays).
func (s *Store) DeleteCommentsBefore(ctx context.Context, cutoff time.Time, batch int) (int64, error) {
	query := `
		DELETE FROM alert_comments WHERE id IN (
			SELECT id FROM alert_comments WHERE created_at < ? LIMIT ?
		)
	`
	return s.batchDeleteLoop(ctx, query, batch, cutoff.UTC())
}

// DeleteSilenceEventsBefore deletes silence_events rows older than cutoff (by
// recorded_at), in batches of batch rows. Pure audit log — no FK to
// alert_events/alert_fingerprints, so no detach step is needed.
func (s *Store) DeleteSilenceEventsBefore(ctx context.Context, cutoff time.Time, batch int) (int64, error) {
	query := `
		DELETE FROM silence_events WHERE id IN (
			SELECT id FROM silence_events WHERE recorded_at < ? LIMIT ?
		)
	`
	return s.batchDeleteLoop(ctx, query, batch, cutoff.UTC())
}

// DeleteOrphanFingerprintsBefore deletes alert_fingerprints rows whose
// last_seen_at is older than cutoff AND that have no remaining alert_events,
// alert_claims, or alert_comments referencing them — a fingerprint that
// still has comments survives, which is what lets those comments reappear
// if the same fingerprint+cluster re-fires later. silence_events do NOT
// block deletion here: they carry no FK to alert_fingerprints and are a
// pure audit log with their own independent retention
// (DeleteSilenceEventsBefore). Must run last in the sweep order, after every
// other delete/detach, so this check reflects the post-sweep state.
func (s *Store) DeleteOrphanFingerprintsBefore(ctx context.Context, cutoff time.Time, batch int) (int64, error) {
	query := `
		DELETE FROM alert_fingerprints WHERE fingerprint IN (
			SELECT f.fingerprint FROM alert_fingerprints f
			WHERE f.last_seen_at < ?
			  AND NOT EXISTS (SELECT 1 FROM alert_events e WHERE e.fingerprint = f.fingerprint)
			  AND NOT EXISTS (SELECT 1 FROM alert_claims c WHERE c.fingerprint = f.fingerprint)
			  AND NOT EXISTS (SELECT 1 FROM alert_comments m WHERE m.fingerprint = f.fingerprint)
			LIMIT ?
		)
	`
	return s.batchDeleteLoop(ctx, query, batch, cutoff.UTC())
}
