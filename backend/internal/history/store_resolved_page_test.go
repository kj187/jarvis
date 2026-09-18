package history

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/alertfilter"
	"github.com/kj187/jarvis/backend/internal/models"
)

func seedResolvedPageAlert(t *testing.T, store *Store, fp, cluster, severity string, recordedAt time.Time) {
	t.Helper()
	if err := store.UpsertFingerprint(fp, "PageAlert", cluster, map[string]string{
		"alertname": "PageAlert", "severity": severity, "instance": "node-" + fp,
	}); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	if _, err := store.exec(context.Background(), `
		INSERT INTO alert_events
			(fingerprint, cluster_name, alertmanager_url, status, starts_at, annotations, recorded_at)
		VALUES (?, ?, 'http://am', 'resolved', ?, ?, ?)
	`, fp, cluster, recordedAt.Add(-time.Hour), `{"summary":"`+fp+`"}`, recordedAt); err != nil {
		t.Fatalf("insert resolved event: %v", err)
	}
}

func TestGetResolvedPage_StablePagesAndTotal(t *testing.T) {
	rec, _ := newTestRecorder(t)
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	for i := 1; i <= 60; i++ {
		seedResolvedPageAlert(t, rec.store, fmt.Sprintf("%016x", i), "cluster-a", "critical", now)
	}

	first, err := rec.store.GetResolvedPage(context.Background(), ResolvedPageQuery{Limit: 25})
	if err != nil {
		t.Fatalf("first page: %v", err)
	}
	second, err := rec.store.GetResolvedPage(context.Background(), ResolvedPageQuery{Limit: 25, Offset: 25})
	if err != nil {
		t.Fatalf("second page: %v", err)
	}
	third, err := rec.store.GetResolvedPage(context.Background(), ResolvedPageQuery{Limit: 25, Offset: 50})
	if err != nil {
		t.Fatalf("third page: %v", err)
	}
	if first.Total != 60 || second.Total != 60 || third.Total != 60 {
		t.Fatalf("totals = %d/%d/%d, want 60", first.Total, second.Total, third.Total)
	}
	if len(first.Alerts) != 25 || len(second.Alerts) != 25 || len(third.Alerts) != 10 {
		t.Fatalf("page lengths = %d/%d/%d, want 25/25/10", len(first.Alerts), len(second.Alerts), len(third.Alerts))
	}
	seen := make(map[string]bool)
	for _, page := range [][]models.EnrichedAlert{first.Alerts, second.Alerts, third.Alerts} {
		for _, alert := range page {
			if seen[alert.Fingerprint] {
				t.Fatalf("duplicate fingerprint %s", alert.Fingerprint)
			}
			seen[alert.Fingerprint] = true
		}
	}
	if first.Alerts[0].Fingerprint != fmt.Sprintf("%016x", 60) || third.Alerts[9].Fingerprint != fmt.Sprintf("%016x", 1) {
		t.Fatalf("event-ID order endpoints = %s/%s", first.Alerts[0].Fingerprint, third.Alerts[9].Fingerprint)
	}
}

func TestGetResolvedPage_FilteredSinglePass(t *testing.T) {
	rec, _ := newTestRecorder(t)
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	seedResolvedPageAlert(t, rec.store, "0000000000000101", "cluster-a", "critical", now)
	seedResolvedPageAlert(t, rec.store, "0000000000000102", "cluster-a", "warning", now.Add(-time.Second))
	seedResolvedPageAlert(t, rec.store, "0000000000000103", "cluster-b", "critical", now.Add(-2*time.Second))

	page, err := rec.store.GetResolvedPage(context.Background(), ResolvedPageQuery{
		Limit: 10, Cluster: "cluster-a", Severity: "critical", Search: "instance",
		Matchers: []alertfilter.Matcher{{Name: "@cluster", Operator: "=", Value: "cluster-a"}},
	})
	if err != nil {
		t.Fatalf("GetResolvedPage: %v", err)
	}
	if page.Total != 1 || len(page.Alerts) != 1 || page.Alerts[0].Fingerprint != "0000000000000101" {
		t.Fatalf("page = %#v", page)
	}
	if page.InvalidMatchers == nil {
		t.Fatal("invalidMatchers = nil, want []")
	}
}

func TestGetResolvedPage_InvalidRegexReported(t *testing.T) {
	rec, _ := newTestRecorder(t)
	seedResolvedPageAlert(t, rec.store, "0000000000000201", "cluster-a", "critical", time.Now().UTC())
	page, err := rec.store.GetResolvedPage(context.Background(), ResolvedPageQuery{
		Limit:    10,
		Matchers: []alertfilter.Matcher{{Name: "instance", Operator: "=~", Value: "("}},
	})
	if err != nil {
		t.Fatalf("GetResolvedPage: %v", err)
	}
	if page.Total != 0 || len(page.InvalidMatchers) != 1 || page.InvalidMatchers[0] != 0 {
		t.Fatalf("page = %#v", page)
	}
}

func TestGetResolvedPage_OffsetPastEndAndFingerprintDetail(t *testing.T) {
	rec, _ := newTestRecorder(t)
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	seedResolvedPageAlert(t, rec.store, "0000000000000301", "cluster-b", "critical", now)
	seedResolvedPageAlert(t, rec.store, "0000000000000301", "cluster-a", "critical", now.Add(-time.Second))

	pastEnd, err := rec.store.GetResolvedPage(context.Background(), ResolvedPageQuery{Limit: 10, Offset: 20})
	if err != nil {
		t.Fatalf("past-end page: %v", err)
	}
	if pastEnd.Total != 2 || len(pastEnd.Alerts) != 0 {
		t.Fatalf("past-end page = %#v", pastEnd)
	}

	detail, err := rec.store.GetResolvedPage(context.Background(), ResolvedPageQuery{
		Limit: 1, Fingerprint: "0000000000000301",
	})
	if err != nil {
		t.Fatalf("fingerprint detail: %v", err)
	}
	if detail.Total != 1 || len(detail.Alerts) != 1 || detail.Alerts[0].ClusterName != "cluster-b" {
		t.Fatalf("bare fingerprint detail = %#v", detail)
	}

	clusterDetail, err := rec.store.GetResolvedPage(context.Background(), ResolvedPageQuery{
		Limit: 1, Fingerprint: "0000000000000301", Cluster: "cluster-a",
	})
	if err != nil {
		t.Fatalf("cluster fingerprint detail: %v", err)
	}
	if clusterDetail.Total != 1 || len(clusterDetail.Alerts) != 1 || clusterDetail.Alerts[0].ClusterName != "cluster-a" {
		t.Fatalf("cluster fingerprint detail = %#v", clusterDetail)
	}

	notFound, err := rec.store.GetResolvedPage(context.Background(), ResolvedPageQuery{
		Limit: 1, Fingerprint: "ffffffffffffffff",
	})
	if err != nil {
		t.Fatalf("missing fingerprint detail: %v", err)
	}
	if notFound.Total != 0 || len(notFound.Alerts) != 0 || notFound.InvalidMatchers == nil {
		t.Fatalf("missing fingerprint detail = %#v", notFound)
	}
}

func TestGetResolvedPage_ExcludesRefired(t *testing.T) {
	rec, _ := newTestRecorder(t)
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	seedResolvedPageAlert(t, rec.store, "0000000000000401", "cluster-a", "critical", now.Add(-time.Minute))
	if _, err := rec.store.exec(context.Background(), `
		INSERT INTO alert_events
			(fingerprint, cluster_name, alertmanager_url, status, starts_at, recorded_at)
		VALUES (?, 'cluster-a', 'http://am', 'firing', ?, ?)
	`, "0000000000000401", now, now); err != nil {
		t.Fatalf("insert refire: %v", err)
	}
	page, err := rec.store.GetResolvedPage(context.Background(), ResolvedPageQuery{Limit: 10})
	if err != nil {
		t.Fatalf("GetResolvedPage: %v", err)
	}
	if page.Total != 0 || len(page.Alerts) != 0 {
		t.Fatalf("refired page = %#v", page)
	}
}

func TestGetResolvedPage_Postgres(t *testing.T) {
	store := newTestPostgresStores(t, 1)[0]
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	for i := 1; i <= 30; i++ {
		seedResolvedPageAlert(t, store, fmt.Sprintf("%016x", i), "cluster-a", []string{"critical", "warning"}[i%2], now)
	}

	page, err := store.GetResolvedPage(context.Background(), ResolvedPageQuery{Limit: 25})
	if err != nil {
		t.Fatalf("PostgreSQL fast page: %v", err)
	}
	if page.Total != 30 || len(page.Alerts) != 25 || page.Alerts[0].Fingerprint != fmt.Sprintf("%016x", 30) {
		t.Fatalf("PostgreSQL fast page = total %d len %d first %q", page.Total, len(page.Alerts), page.Alerts[0].Fingerprint)
	}

	filtered, err := store.GetResolvedPage(context.Background(), ResolvedPageQuery{
		Limit: 10, Severity: "critical", Matchers: []alertfilter.Matcher{{Name: "@cluster", Operator: "=", Value: "cluster-a"}},
	})
	if err != nil {
		t.Fatalf("PostgreSQL filtered page: %v", err)
	}
	if filtered.Total != 15 || len(filtered.Alerts) != 10 {
		t.Fatalf("PostgreSQL filtered page = total %d len %d", filtered.Total, len(filtered.Alerts))
	}
}

func TestResolvedPage_PostgresTransactionIsReadOnlyRepeatableRead(t *testing.T) {
	store := newTestPostgresStores(t, 1)[0]
	tx, err := store.beginResolvedPageRead(context.Background())
	if err != nil {
		t.Fatalf("beginResolvedPageRead: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	var isolation string
	var readOnly string
	if err := tx.QueryRowContext(context.Background(), `SHOW transaction_isolation`).Scan(&isolation); err != nil {
		t.Fatalf("read transaction_isolation: %v", err)
	}
	if err := tx.QueryRowContext(context.Background(), `SHOW transaction_read_only`).Scan(&readOnly); err != nil {
		t.Fatalf("read transaction_read_only: %v", err)
	}
	if isolation != "repeatable read" || readOnly != "on" {
		t.Fatalf("transaction = isolation %q read_only %q", isolation, readOnly)
	}
}

func TestGetResolvedPage_CancelReleasesSQLiteConnection(t *testing.T) {
	rec, _ := newTestRecorder(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := rec.store.GetResolvedPage(ctx, ResolvedPageQuery{Limit: 10})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("GetResolvedPage error = %v, want context.Canceled", err)
	}
	reuseCtx, reuseCancel := context.WithTimeout(context.Background(), time.Second)
	defer reuseCancel()
	if _, err := rec.store.exec(reuseCtx, `SELECT 1`); err != nil {
		t.Fatalf("reuse SQLite connection after cancellation: %v", err)
	}
}
