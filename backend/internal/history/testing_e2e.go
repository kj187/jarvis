//go:build e2e

package history

import (
	"context"
	"time"

	"github.com/kj187/jarvis/backend/internal/models"
)

// ResetForTesting truncates all mutable history tables. Only compiled into the
// binary when built with the "e2e" build tag — never present in production.
func (s *Store) ResetForTesting() error {
	tables := []string{
		"alert_comments",
		"alert_claims",
		"silence_events",
		"alert_events",
		"alert_fingerprints",
		"users",
	}
	for _, t := range tables {
		if _, err := s.exec(context.Background(), "DELETE FROM "+t); err != nil {
			return err
		}
	}
	return nil
}

// SeedResolvedForTesting inserts a complete firing→resolved lifecycle for one
// alert so it appears in the resolved view and history. e2e-only.
func (s *Store) SeedResolvedForTesting(
	fingerprint, alertname, clusterName, amURL string,
	labels, annotations map[string]string,
	startsAt, resolvedAt time.Time,
) error {
	if err := s.UpsertFingerprint(fingerprint, alertname, clusterName, labels); err != nil {
		return err
	}
	if _, _, err := s.RecordStatusChange(fingerprint, clusterName, amURL, models.EventStatusFiring, startsAt, annotations); err != nil {
		return err
	}
	return s.RecordResolvedForCluster(fingerprint, clusterName, resolvedAt)
}
