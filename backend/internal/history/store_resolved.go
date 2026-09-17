package history

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/kj187/jarvis/backend/internal/models"
)

type ResolvedReadQuery struct {
	Cluster     string
	Fingerprint string
	After       time.Time
	Through     time.Time
}

type resolvedAlertScanner interface {
	Scan(...any) error
}

func scanResolvedAlert(scanner resolvedAlertScanner) (models.EnrichedAlert, error) {
	var alert models.EnrichedAlert
	var labelsJSON string
	var annotationsJSON sql.NullString
	var resolvedAt time.Time
	if err := scanner.Scan(
		&alert.Fingerprint, &alert.ClusterName, &alert.AlertmanagerURL,
		&alert.StartsAt, &resolvedAt, &annotationsJSON, &labelsJSON,
	); err != nil {
		return models.EnrichedAlert{}, fmt.Errorf("scan resolved alert: %w", err)
	}
	if err := json.Unmarshal([]byte(labelsJSON), &alert.Labels); err != nil {
		alert.Labels = map[string]string{}
	}
	if annotationsJSON.Valid {
		if err := json.Unmarshal([]byte(annotationsJSON.String), &alert.Annotations); err != nil {
			alert.Annotations = map[string]string{}
		}
	}
	if alert.Annotations == nil {
		alert.Annotations = map[string]string{}
	}
	if receiverNames := alert.Labels["@receiver"]; receiverNames != "" {
		for _, name := range strings.Split(receiverNames, ",") {
			if trimmed := strings.TrimSpace(name); trimmed != "" {
				alert.Receivers = append(alert.Receivers, models.Receiver{Name: trimmed})
			}
		}
	}
	alert.Status = models.AlertStatus{State: "resolved", InhibitedBy: []string{}, SilencedBy: []string{}}
	alert.StartsAt = alert.StartsAt.UTC()
	alert.EndsAt = resolvedAt.UTC()
	alert.UpdatedAt = alert.EndsAt
	return alert, nil
}

// VisitResolved visits the latest resolved alert episodes one row at a time.
// The callback must not issue another query through Store: SQLite deliberately
// has a single database connection, which remains occupied until rows is closed.
func (s *Store) VisitResolved(ctx context.Context, query ResolvedReadQuery, visit func(models.EnrichedAlert) error) error {
	where := "WHERE e.status = 'resolved'"
	args := make([]interface{}, 0, 4)
	if query.Cluster != "" {
		where += " AND e.cluster_name = ?"
		args = append(args, query.Cluster)
	}
	if query.Fingerprint != "" {
		where += " AND e.fingerprint = ?"
		args = append(args, query.Fingerprint)
	}
	if !query.After.IsZero() {
		where += " AND e.recorded_at > ?"
		args = append(args, query.After.UTC())
	}
	if !query.Through.IsZero() {
		where += " AND e.recorded_at <= ?"
		args = append(args, query.Through.UTC())
	}
	rows, err := s.query(ctx, `
		WITH latest AS (
			SELECT fingerprint, cluster_name, MAX(id) AS max_id
			FROM alert_events
			GROUP BY fingerprint, cluster_name
		)
		SELECT e.fingerprint, e.cluster_name, e.alertmanager_url, e.starts_at,
		       e.recorded_at, e.annotations, f.labels
		FROM alert_events e
		JOIN latest ON e.id = latest.max_id
		JOIN alert_fingerprints f ON f.fingerprint = e.fingerprint
		`+where+`
		ORDER BY e.recorded_at DESC, e.id DESC
	`, args...)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		if err := ctx.Err(); err != nil {
			return err
		}
		alert, err := scanResolvedAlert(rows)
		if err != nil {
			return err
		}
		if err := visit(alert); err != nil {
			return err
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return rows.Err()
}

func (s *Store) VisitRecentResolved(
	ctx context.Context,
	now time.Time,
	window time.Duration,
	visit func(models.EnrichedAlert) error,
) error {
	return s.VisitResolved(ctx, ResolvedReadQuery{
		After:   now.UTC().Add(-window),
		Through: now.UTC(),
	}, visit)
}
