package history

import (
	"context"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/alertmanager"
	"github.com/kj187/jarvis/backend/internal/models"
)

func TestEncodeDecodeSnapshot_RoundTrip(t *testing.T) {
	want := pollSnapshot{
		Alerts: []models.EnrichedAlert{
			{Fingerprint: "fp1", ClusterName: "a", Status: models.AlertStatus{State: "active"}},
		},
		Silences: []alertmanager.GettableSilence{
			{ID: "sil-1", Comment: "test"},
		},
		MemberUp: map[string]bool{"am-1": true, "am-2": false},
	}

	payload, err := encodeSnapshot(want)
	if err != nil {
		t.Fatalf("encodeSnapshot: %v", err)
	}
	if len(payload) == 0 {
		t.Fatal("expected non-empty gzip payload")
	}

	got, err := decodeSnapshot(payload)
	if err != nil {
		t.Fatalf("decodeSnapshot: %v", err)
	}
	if len(got.Alerts) != 1 || got.Alerts[0].Fingerprint != "fp1" {
		t.Errorf("Alerts round-trip = %+v", got.Alerts)
	}
	if len(got.Silences) != 1 || got.Silences[0].ID != "sil-1" {
		t.Errorf("Silences round-trip = %+v", got.Silences)
	}
	if got.MemberUp["am-1"] != true || got.MemberUp["am-2"] != false {
		t.Errorf("MemberUp round-trip = %+v", got.MemberUp)
	}
}

func TestDecodeSnapshot_InvalidPayload(t *testing.T) {
	if _, err := decodeSnapshot([]byte("not gzip")); err == nil {
		t.Error("expected error decoding non-gzip payload")
	}
}

// TestSnapshotStore_SQLite_NoOp verifies D3 item 8: SQLite has no snapshot
// machinery — every snapshot Store method is a safe no-op.
func TestSnapshotStore_SQLite_NoOp(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	if err := s.PersistSnapshot(ctx, "a", []byte("x"), time.Now()); err != nil {
		t.Fatalf("PersistSnapshot on SQLite must no-op, got err: %v", err)
	}
	if _, found, err := s.GetSnapshot(ctx, "a"); err != nil || found {
		t.Fatalf("GetSnapshot on SQLite = found=%v err=%v, want found=false err=nil", found, err)
	}
	all, err := s.GetAllSnapshots(ctx)
	if err != nil || len(all) != 0 {
		t.Fatalf("GetAllSnapshots on SQLite = %v err=%v, want empty map", all, err)
	}
	if err := s.NotifySnapshotChanged(ctx, "a"); err != nil {
		t.Fatalf("NotifySnapshotChanged on SQLite must no-op, got err: %v", err)
	}
	if err := s.NotifyTrigger(ctx); err != nil {
		t.Fatalf("NotifyTrigger on SQLite must no-op, got err: %v", err)
	}
}

// TestSnapshotStore_Postgres_PersistAndGet is JARVIS_TEST_POSTGRES_DSN-gated.
func TestSnapshotStore_Postgres_PersistAndGet(t *testing.T) {
	stores := newTestPostgresStores(t, 1)
	s := stores[0]
	ctx := context.Background()

	if _, found, err := s.GetSnapshot(ctx, "cluster-a"); err != nil || found {
		t.Fatalf("GetSnapshot before any persist = found=%v err=%v, want false/nil", found, err)
	}

	snap := pollSnapshot{
		Alerts:   []models.EnrichedAlert{{Fingerprint: "fp1", ClusterName: "cluster-a"}},
		MemberUp: map[string]bool{"am-1": true},
	}
	payload, err := encodeSnapshot(snap)
	if err != nil {
		t.Fatalf("encodeSnapshot: %v", err)
	}
	takenAt := time.Now().UTC().Truncate(time.Millisecond)
	if err := s.PersistSnapshot(ctx, "cluster-a", payload, takenAt); err != nil {
		t.Fatalf("PersistSnapshot: %v", err)
	}

	row, found, err := s.GetSnapshot(ctx, "cluster-a")
	if err != nil || !found {
		t.Fatalf("GetSnapshot after persist = found=%v err=%v, want true/nil", found, err)
	}
	if row.TakenAt.Sub(takenAt).Abs() > time.Second {
		t.Errorf("TakenAt = %v, want ~%v", row.TakenAt, takenAt)
	}
	got, err := decodeSnapshot(row.Payload)
	if err != nil {
		t.Fatalf("decodeSnapshot: %v", err)
	}
	if len(got.Alerts) != 1 || got.Alerts[0].Fingerprint != "fp1" {
		t.Errorf("persisted payload round-trip = %+v", got)
	}

	// Upsert: persisting again for the same cluster replaces, doesn't duplicate.
	takenAt2 := takenAt.Add(time.Minute)
	if err := s.PersistSnapshot(ctx, "cluster-a", payload, takenAt2); err != nil {
		t.Fatalf("PersistSnapshot (upsert): %v", err)
	}
	all, err := s.GetAllSnapshots(ctx)
	if err != nil {
		t.Fatalf("GetAllSnapshots: %v", err)
	}
	if len(all) != 1 {
		t.Fatalf("GetAllSnapshots after upsert = %d rows, want 1 (no duplicate)", len(all))
	}
	if all["cluster-a"].TakenAt.Sub(takenAt2).Abs() > time.Second {
		t.Errorf("upserted TakenAt = %v, want ~%v", all["cluster-a"].TakenAt, takenAt2)
	}
}

// TestSnapshotStore_Postgres_NotifyDelivers is JARVIS_TEST_POSTGRES_DSN-gated:
// verifies pg_notify on both channels actually delivers to a LISTEN-ing
// session, using a raw connection (the same mechanism the follower/leader
// listener loops use in production).
func TestSnapshotStore_Postgres_NotifyDelivers(t *testing.T) {
	dsn := postgresTestDSN(t)
	stores := newTestPostgresStores(t, 1)
	s := stores[0]

	conn := dialRawListener(t, dsn, notifyChannelSnapshot)
	if err := s.NotifySnapshotChanged(context.Background(), "cluster-a"); err != nil {
		t.Fatalf("NotifySnapshotChanged: %v", err)
	}
	n := waitForNotification(t, conn, 5*time.Second)
	if n.Payload != "cluster-a" {
		t.Errorf("notification payload = %q, want %q", n.Payload, "cluster-a")
	}

	conn2 := dialRawListener(t, dsn, notifyChannelTrigger)
	if err := s.NotifyTrigger(context.Background()); err != nil {
		t.Fatalf("NotifyTrigger: %v", err)
	}
	n2 := waitForNotification(t, conn2, 5*time.Second)
	if n2.Channel != notifyChannelTrigger {
		t.Errorf("notification channel = %q, want %q", n2.Channel, notifyChannelTrigger)
	}
}
