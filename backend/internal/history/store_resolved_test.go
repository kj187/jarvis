package history

import (
	"context"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/models"
)

func insertResolvedTestEvent(t *testing.T, store *Store, fingerprint, cluster, status string, recordedAt time.Time) {
	t.Helper()
	if err := store.UpsertFingerprint(fingerprint, "TestAlert", cluster, map[string]string{"alertname": "TestAlert"}); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	if _, err := store.exec(context.Background(), `
		INSERT INTO alert_events
			(fingerprint, cluster_name, alertmanager_url, status, starts_at, recorded_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, fingerprint, cluster, "http://am:9093", status, recordedAt.Add(-time.Minute), recordedAt); err != nil {
		t.Fatalf("insert event: %v", err)
	}
}

func visitRecentFingerprints(t *testing.T, store *Store, now time.Time, cluster string) []string {
	t.Helper()
	got := make([]string, 0)
	err := store.visitResolved(context.Background(), ResolvedReadQuery{
		Cluster: cluster,
		After:   now.Add(-ResolvedBufferTTL),
		Through: now,
	}, func(alert models.EnrichedAlert) error {
		got = append(got, alert.Fingerprint+"/"+alert.ClusterName)
		return nil
	})
	if err != nil {
		t.Fatalf("visitResolved: %v", err)
	}
	return got
}

func TestRecentResolved_ExcludesRefired(t *testing.T) {
	rec, _ := newTestRecorder(t)
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	insertResolvedTestEvent(t, rec.store, "fp1", "a", models.EventStatusResolved, now.Add(-10*time.Minute))
	insertResolvedTestEvent(t, rec.store, "fp1", "a", models.EventStatusFiring, now.Add(-5*time.Minute))

	if got := visitRecentFingerprints(t, rec.store, now, ""); len(got) != 0 {
		t.Fatalf("got %v, want refired alert excluded", got)
	}
}

func TestRecentResolved_ClusterIsolation(t *testing.T) {
	rec, _ := newTestRecorder(t)
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	insertResolvedTestEvent(t, rec.store, "fp1", "a", models.EventStatusResolved, now.Add(-time.Minute))
	insertResolvedTestEvent(t, rec.store, "fp1", "b", models.EventStatusResolved, now.Add(-2*time.Minute))

	got := visitRecentFingerprints(t, rec.store, now, "a")
	if len(got) != 1 || got[0] != "fp1/a" {
		t.Fatalf("got %v, want [fp1/a]", got)
	}
}

func TestRecentResolved_BoundaryAtTTL(t *testing.T) {
	rec, _ := newTestRecorder(t)
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	insertResolvedTestEvent(t, rec.store, "before", "a", models.EventStatusResolved, now.Add(-ResolvedBufferTTL-time.Nanosecond))
	insertResolvedTestEvent(t, rec.store, "at", "a", models.EventStatusResolved, now.Add(-ResolvedBufferTTL))
	insertResolvedTestEvent(t, rec.store, "inside", "a", models.EventStatusResolved, now.Add(-ResolvedBufferTTL+time.Nanosecond))
	insertResolvedTestEvent(t, rec.store, "through", "a", models.EventStatusResolved, now)
	insertResolvedTestEvent(t, rec.store, "future", "a", models.EventStatusResolved, now.Add(time.Nanosecond))

	got := visitRecentFingerprints(t, rec.store, now, "")
	if len(got) != 2 || got[0] != "through/a" || got[1] != "inside/a" {
		t.Fatalf("got %v, want [through/a inside/a]", got)
	}
}
