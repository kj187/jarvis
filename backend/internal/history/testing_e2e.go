//go:build e2e

package history

import (
	"context"
	"encoding/json"
	"fmt"
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

// FiringCycle is one historical firing→resolved window to backfill directly.
type FiringCycle struct {
	StartsAt   time.Time
	ResolvedAt time.Time
}

// SeedFiringHistoryForTesting inserts a sequence of historical firing→resolved
// event pairs for one fingerprint (e.g. for a realistic heatmap in
// screenshots), with recorded_at set to each cycle's own timestamp rather
// than real wall-clock time.
//
// Deliberately bypasses RecordStatusChange/RecordResolvedForCluster: their
// idempotency check and 60s grace period assume recorded_at tracks real time
// (true for live poll ingestion). Reusing them to backfill several historical
// cycles in one rapid test run breaks down — recorded_at on the very first
// firing row is real "now", which no later *historical* (deliberately past)
// resolved row can ever exceed, so every subsequent seeded cycle sees that
// first firing row as still "last" and gets silently no-op'd or merged into
// it via the grace period. See .agents/lessons.md. e2e-only.
//
// Expects the fingerprint to already have exactly one real occurrence
// recorded (a live alert fired through the normal poll path) — the
// occurrence_count bump below adds len(cycles) on top of that starting 1, so
// the final count is "1 live + N historical". Don't call this against a
// fingerprint that was never live-fired first, and don't wipe alert_events
// afterward — see fireWithHeatmapHistory (e2e/support/heatmapHistory.ts).
func (s *Store) SeedFiringHistoryForTesting(
	fingerprint, alertname, clusterName, amURL string,
	labels, annotations map[string]string,
	cycles []FiringCycle,
) error {
	if err := s.UpsertFingerprint(fingerprint, alertname, clusterName, labels); err != nil {
		return err
	}
	annJSON, err := json.Marshal(annotations)
	if err != nil {
		return fmt.Errorf("marshal annotations: %w", err)
	}
	for _, cyc := range cycles {
		if _, err := s.exec(context.Background(), `
			INSERT INTO alert_events (fingerprint, cluster_name, alertmanager_url, status, starts_at, annotations, recorded_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, fingerprint, clusterName, amURL, models.EventStatusFiring, cyc.StartsAt.UTC(), string(annJSON), cyc.StartsAt.UTC()); err != nil {
			return fmt.Errorf("insert firing cycle: %w", err)
		}
		if _, err := s.exec(context.Background(), `
			INSERT INTO alert_events (fingerprint, cluster_name, alertmanager_url, status, starts_at, annotations, recorded_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, fingerprint, clusterName, amURL, models.EventStatusResolved, cyc.StartsAt.UTC(), string(annJSON), cyc.ResolvedAt.UTC()); err != nil {
			return fmt.Errorf("insert resolved cycle: %w", err)
		}
	}
	if len(cycles) > 0 {
		if _, err := s.exec(context.Background(),
			`UPDATE alert_fingerprints SET occurrence_count = occurrence_count + ? WHERE fingerprint = ? AND cluster_name = ?`,
			len(cycles), fingerprint, clusterName,
		); err != nil {
			return fmt.Errorf("bump occurrence_count: %w", err)
		}
	}
	return nil
}
