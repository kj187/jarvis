package history

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/alertfilter"
	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/models"
)

var memoryBenchmarkTime = time.Date(2026, 9, 17, 6, 0, 0, 0, time.UTC)

func memoryBenchmarkLabels(i int) map[string]string {
	severity := []string{"critical", "warning", "info", "none"}[i%4]
	value := fmt.Sprintf("value-%06d", i)
	return map[string]string{
		"alertname":   "MemoryBenchmarkAlert",
		"severity":    severity,
		"namespace":   value,
		"pod":         "pod-" + value,
		"instance":    "instance-" + value,
		"job":         "job-" + value,
		"service":     "service-" + value,
		"team":        "team-" + value,
		"environment": "environment-" + value,
		"region":      "region-" + value,
		"node":        "node-" + value,
		"@receiver":   "oncall,email",
	}
}

func memoryBenchmarkAnnotations(withAnnotations bool) map[string]string {
	if !withAnnotations {
		return map[string]string{}
	}
	value := strings.Repeat("x", 200)
	return map[string]string{
		"summary":     value,
		"description": value,
		"runbook_url": value,
	}
}

func seedMemoryResolvedFixture(b *testing.B, rows int, withAnnotations bool) *Store {
	b.Helper()
	database, dialect, err := idb.Open(":memory:")
	if err != nil {
		b.Fatalf("open fixture database: %v", err)
	}
	b.Cleanup(func() { _ = database.Close() })
	if err := idb.Migrate(database, dialect); err != nil {
		b.Fatalf("migrate fixture database: %v", err)
	}

	ctx := context.Background()
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		b.Fatalf("begin fixture transaction: %v", err)
	}
	fingerprintStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO alert_fingerprints
			(fingerprint, alertname, cluster_name, labels, first_seen_at, last_seen_at, occurrence_count)
		VALUES (?, ?, ?, ?, ?, ?, 1)`)
	if err != nil {
		_ = tx.Rollback()
		b.Fatalf("prepare fingerprint insert: %v", err)
	}
	defer func() { _ = fingerprintStmt.Close() }()
	eventStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO alert_events
			(fingerprint, cluster_name, alertmanager_url, status, starts_at, ends_at, annotations, recorded_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		_ = tx.Rollback()
		b.Fatalf("prepare event insert: %v", err)
	}
	defer func() { _ = eventStmt.Close() }()

	annotationsJSON, err := json.Marshal(memoryBenchmarkAnnotations(withAnnotations))
	if err != nil {
		b.Fatalf("marshal annotations: %v", err)
	}
	for i := 0; i < rows; i++ {
		fingerprint := fmt.Sprintf("%016x", i+1)
		clusterName := fmt.Sprintf("cluster-%d", i%4)
		labelsJSON, marshalErr := json.Marshal(memoryBenchmarkLabels(i))
		if marshalErr != nil {
			b.Fatalf("marshal labels: %v", marshalErr)
		}
		startsAt := memoryBenchmarkTime.Add(-time.Duration(i) * time.Second)
		resolvedAt := startsAt.Add(30 * time.Second)
		if _, err := fingerprintStmt.ExecContext(ctx, fingerprint, "MemoryBenchmarkAlert", clusterName, string(labelsJSON), startsAt, resolvedAt); err != nil {
			b.Fatalf("insert fingerprint %d: %v", i, err)
		}
		if _, err := eventStmt.ExecContext(ctx, fingerprint, clusterName, "http://alertmanager:9093", models.EventStatusFiring, startsAt, nil, string(annotationsJSON), startsAt); err != nil {
			b.Fatalf("insert firing event %d: %v", i, err)
		}
		if _, err := eventStmt.ExecContext(ctx, fingerprint, clusterName, "http://alertmanager:9093", models.EventStatusResolved, startsAt, resolvedAt, string(annotationsJSON), resolvedAt); err != nil {
			b.Fatalf("insert resolved event %d: %v", i, err)
		}
	}
	if err := tx.Commit(); err != nil {
		b.Fatalf("commit fixture transaction: %v", err)
	}
	return NewStore(database, dialect)
}

func memoryFixtureAlerts(active, resolved int) []models.EnrichedAlert {
	alerts := make([]models.EnrichedAlert, 0, active+resolved)
	for i := 0; i < active+resolved; i++ {
		state := "active"
		if i >= active {
			state = "resolved"
		}
		alerts = append(alerts, models.EnrichedAlert{
			Fingerprint: fmt.Sprintf("%016x", i+1),
			Status: models.AlertStatus{
				State:       state,
				InhibitedBy: []string{},
				SilencedBy:  []string{},
			},
			Labels:          memoryBenchmarkLabels(i),
			Annotations:     memoryBenchmarkAnnotations(true),
			StartsAt:        memoryBenchmarkTime.Add(-time.Duration(i) * time.Second),
			EndsAt:          memoryBenchmarkTime,
			UpdatedAt:       memoryBenchmarkTime,
			Receivers:       []models.Receiver{{Name: "oncall"}, {Name: "email"}},
			ClusterName:     fmt.Sprintf("cluster-%d", i%4),
			AlertmanagerURL: "http://alertmanager:9093",
		})
	}
	return alerts
}

func BenchmarkMemoryResolvedLegacy(b *testing.B) {
	for _, rows := range []int{2_000, 10_000, 30_000, 100_000} {
		for _, withAnnotations := range []bool{false, true} {
			name := fmt.Sprintf("rows=%d/annotations=%t", rows, withAnnotations)
			b.Run(name, func(b *testing.B) {
				store := seedMemoryResolvedFixture(b, rows, withAnnotations)
				b.ReportAllocs()
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					alerts, err := store.GetAllResolved()
					if err != nil {
						b.Fatalf("GetAllResolved: %v", err)
					}
					if len(alerts) != rows {
						b.Fatalf("resolved rows = %d, want %d", len(alerts), rows)
					}
				}
			})
		}
	}
}

func BenchmarkMemoryResolvedPage(b *testing.B) {
	for _, rows := range []int{2_000, 10_000, 30_000, 100_000} {
		b.Run(fmt.Sprintf("rows=%d", rows), func(b *testing.B) {
			store := seedMemoryResolvedFixture(b, rows, true)
			query := ResolvedPageQuery{Limit: 25}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				page, err := store.GetResolvedPage(context.Background(), query)
				if err != nil {
					b.Fatalf("GetResolvedPage: %v", err)
				}
				if len(page.Alerts) != 25 || page.Total != int64(rows) {
					b.Fatalf("page len/total = %d/%d, want 25/%d", len(page.Alerts), page.Total, rows)
				}
			}
		})
	}
}

func BenchmarkMemoryResolvedCount(b *testing.B) {
	for _, rows := range []int{2_000, 10_000, 30_000, 100_000} {
		b.Run(fmt.Sprintf("rows=%d", rows), func(b *testing.B) {
			store := seedMemoryResolvedFixture(b, rows, false)
			base, args := resolvedPageBase(ResolvedPageQuery{})
			query := base + `
				SELECT COUNT(*) FROM alert_events e
				JOIN latest ON e.id = latest.max_id
				WHERE e.status = 'resolved'`
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				var total int64
				if err := store.queryRow(context.Background(), query, args...).Scan(&total); err != nil {
					b.Fatalf("count resolved: %v", err)
				}
				if total != int64(rows) {
					b.Fatalf("total = %d, want %d", total, rows)
				}
			}
		})
	}
}

func BenchmarkMemoryResolvedPageFiltered(b *testing.B) {
	for _, rows := range []int{2_000, 10_000, 30_000, 100_000} {
		b.Run(fmt.Sprintf("rows=%d", rows), func(b *testing.B) {
			store := seedMemoryResolvedFixture(b, rows, true)
			query := ResolvedPageQuery{
				Limit:    25,
				Matchers: []alertfilter.Matcher{{Name: "instance", Operator: "=~", Value: `instance-value-0`}},
				Now:      memoryBenchmarkTime,
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				page, err := store.GetResolvedPage(context.Background(), query)
				if err != nil {
					b.Fatalf("GetResolvedPage filtered: %v", err)
				}
				if len(page.Alerts) > 25 || page.Total == 0 {
					b.Fatalf("filtered page len/total = %d/%d", len(page.Alerts), page.Total)
				}
			}
		})
	}
}

func BenchmarkMemorySnapshotCodec(b *testing.B) {
	for _, resolved := range []int{0, 6_000, 30_000} {
		for _, clusters := range []int{1, 4} {
			b.Run(fmt.Sprintf("resolved=%d/clusters=%d", resolved, clusters), func(b *testing.B) {
				alerts := memoryFixtureAlerts(2_000, resolved)
				for i := range alerts {
					alerts[i].ClusterName = fmt.Sprintf("cluster-%d", i%clusters)
				}
				snapshot := pollSnapshot{Alerts: alerts, MemberUp: map[string]bool{"member-0": true}}
				b.ReportAllocs()
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					payload, err := encodeSnapshot(snapshot)
					if err != nil {
						b.Fatalf("encode snapshot: %v", err)
					}
					decoded, err := decodeSnapshot(payload)
					if err != nil {
						b.Fatalf("decode snapshot: %v", err)
					}
					if len(decoded.Alerts) != len(alerts) {
						b.Fatalf("decoded alerts = %d, want %d", len(decoded.Alerts), len(alerts))
					}
				}
			})
		}
	}
}
