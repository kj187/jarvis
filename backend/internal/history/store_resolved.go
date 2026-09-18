package history

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/kj187/jarvis/backend/internal/alertfilter"
	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/models"
)

type ResolvedReadQuery struct {
	Cluster     string
	Fingerprint string
	After       time.Time
	Through     time.Time
}

type ResolvedPageQuery struct {
	Limit       int
	Offset      int
	Cluster     string
	Severity    string
	Search      string
	Fingerprint string
	Matchers    []alertfilter.Matcher
	Now         time.Time
}

type resolvedAlertScanner interface {
	Scan(...any) error
}

type resolvedAlertRow struct {
	fingerprint     string
	clusterName     string
	alertmanagerURL string
	startsAt        time.Time
	resolvedAt      time.Time
	annotationsJSON sql.NullString
	labelsJSON      string
}

func scanResolvedAlertRow(scanner resolvedAlertScanner) (resolvedAlertRow, error) {
	var row resolvedAlertRow
	if err := scanner.Scan(
		&row.fingerprint, &row.clusterName, &row.alertmanagerURL,
		&row.startsAt, &row.resolvedAt, &row.annotationsJSON, &row.labelsJSON,
	); err != nil {
		return resolvedAlertRow{}, fmt.Errorf("scan resolved alert: %w", err)
	}
	return row, nil
}

func resolvedAlertFromRow(row resolvedAlertRow, decodeAnnotations bool) models.EnrichedAlert {
	alert := models.EnrichedAlert{
		Fingerprint: row.fingerprint, ClusterName: row.clusterName, AlertmanagerURL: row.alertmanagerURL,
	}
	if err := json.Unmarshal([]byte(row.labelsJSON), &alert.Labels); err != nil {
		alert.Labels = map[string]string{}
	}
	if decodeAnnotations && row.annotationsJSON.Valid {
		if err := json.Unmarshal([]byte(row.annotationsJSON.String), &alert.Annotations); err != nil {
			alert.Annotations = map[string]string{}
		}
	}
	if decodeAnnotations && alert.Annotations == nil {
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
	alert.StartsAt = row.startsAt.UTC()
	alert.EndsAt = row.resolvedAt.UTC()
	alert.UpdatedAt = alert.EndsAt
	return alert
}

func scanResolvedAlert(scanner resolvedAlertScanner) (models.EnrichedAlert, error) {
	row, err := scanResolvedAlertRow(scanner)
	if err != nil {
		return models.EnrichedAlert{}, err
	}
	return resolvedAlertFromRow(row, true), nil
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

func resolvedPageBase(query ResolvedPageQuery) (string, []interface{}) {
	cteWhere := ""
	args := make([]interface{}, 0, 2)
	if query.Cluster != "" {
		cteWhere += " WHERE cluster_name = ?"
		args = append(args, query.Cluster)
	}
	if query.Fingerprint != "" {
		if cteWhere == "" {
			cteWhere = " WHERE fingerprint = ?"
		} else {
			cteWhere += " AND fingerprint = ?"
		}
		args = append(args, query.Fingerprint)
	}
	return `
		WITH latest AS (
			SELECT fingerprint, cluster_name, MAX(id) AS max_id
			FROM alert_events` + cteWhere + `
			GROUP BY fingerprint, cluster_name
		)
`, args
}

func (s *Store) GetResolvedPage(ctx context.Context, query ResolvedPageQuery) (models.ResolvedAlertsPage, error) {
	result := models.ResolvedAlertsPage{Alerts: []models.EnrichedAlert{}, InvalidMatchers: []int{}}
	tx, err := s.beginResolvedPageRead(ctx)
	if err != nil {
		return result, err
	}
	defer func() { _ = tx.Rollback() }()

	base, args := resolvedPageBase(query)
	selectRows := `
		SELECT e.fingerprint, e.cluster_name, e.alertmanager_url, e.starts_at,
		       e.recorded_at, e.annotations, f.labels
		FROM alert_events e
		JOIN latest ON e.id = latest.max_id
		JOIN alert_fingerprints f ON f.fingerprint = e.fingerprint
		WHERE e.status = 'resolved'
		ORDER BY e.recorded_at DESC, e.id DESC`

	filtered := query.Search != "" || len(query.Matchers) > 0 || query.Severity != ""
	if !filtered {
		pageArgs := append(append([]interface{}{}, args...), query.Limit, query.Offset)
		rows, err := s.queryOn(tx, ctx, base+selectRows+" LIMIT ? OFFSET ?", pageArgs...)
		if err != nil {
			return result, fmt.Errorf("query resolved page: %w", err)
		}
		for rows.Next() {
			alert, scanErr := scanResolvedAlert(rows)
			if scanErr != nil {
				_ = rows.Close()
				return result, scanErr
			}
			result.Alerts = append(result.Alerts, alert)
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return result, err
		}
		if err := rows.Close(); err != nil {
			return result, err
		}
		if err := s.queryRowOn(tx, ctx, base+`
			SELECT COUNT(*) FROM alert_events e
			JOIN latest ON e.id = latest.max_id
			WHERE e.status = 'resolved'`, args...).Scan(&result.Total); err != nil {
			return result, fmt.Errorf("count resolved page: %w", err)
		}
	} else {
		compiled, invalid := alertfilter.Compile(query.Matchers)
		result.InvalidMatchers = invalid
		now := query.Now
		if now.IsZero() {
			now = time.Now().UTC().Truncate(time.Millisecond)
		}
		rows, err := s.queryOn(tx, ctx, base+selectRows, args...)
		if err != nil {
			return result, fmt.Errorf("query filtered resolved page: %w", err)
		}
		defer func() { _ = rows.Close() }()
		for rows.Next() {
			row, scanErr := scanResolvedAlertRow(rows)
			if scanErr != nil {
				return result, scanErr
			}
			alert := resolvedAlertFromRow(row, false)
			if query.Severity != "" && alert.Labels["severity"] != query.Severity {
				continue
			}
			if query.Search != "" && !alertfilter.MatchesSearch(alert.Labels, query.Search) {
				continue
			}
			if !compiled.Match(alert, now) {
				continue
			}
			if result.Total >= int64(query.Offset) && len(result.Alerts) < query.Limit {
				alert = resolvedAlertFromRow(row, true)
				result.Alerts = append(result.Alerts, alert)
			}
			result.Total++
		}
		if err := rows.Err(); err != nil {
			return result, err
		}
	}
	if query.Fingerprint != "" && result.Total > 1 {
		result.Total = 1
	}
	if err := tx.Commit(); err != nil {
		return result, fmt.Errorf("commit resolved page read: %w", err)
	}
	return result, nil
}

func (s *Store) beginResolvedPageRead(ctx context.Context) (*sql.Tx, error) {
	options := &sql.TxOptions{ReadOnly: true}
	if s.dialect == idb.DialectPostgres {
		options.Isolation = sql.LevelRepeatableRead
	}
	tx, err := s.db.BeginTx(ctx, options)
	if err != nil {
		return nil, fmt.Errorf("begin resolved page read: %w", err)
	}
	return tx, nil
}
