package history

import (
	"github.com/kj187/jarvis/backend/internal/config"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/models"
)

const customTTL = time.Hour

func TestAlertStore_ResolvedTTL_ZeroValueFallsBackToDefault(t *testing.T) {
	s := &AlertStore{}
	if got := s.ResolvedTTL(); got != DefaultResolvedBufferTTL {
		t.Fatalf("ResolvedTTL() = %v, want %v", got, DefaultResolvedBufferTTL)
	}
	s.SetResolvedTTL(0)
	if got := s.ResolvedTTL(); got != DefaultResolvedBufferTTL {
		t.Fatalf("ResolvedTTL() after SetResolvedTTL(0) = %v, want default", got)
	}
}

func TestNewAlertStore_UsesConfiguredTTL(t *testing.T) {
	if got := NewAlertStore(customTTL).ResolvedTTL(); got != customTTL {
		t.Fatalf("ResolvedTTL() = %v, want %v", got, customTTL)
	}
}

func TestResolvedBuffer_CustomTTL_MarkAndExpire(t *testing.T) {
	base := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	s := NewAlertStore(customTTL)
	s.Set([]models.EnrichedAlert{makeAlert("fp1", "active")})
	s.markResolvedAt("fp1", base)
	if s.ExpireResolved(base.Add(DefaultResolvedBufferTTL)) || len(s.Get()) != 1 {
		t.Fatal("entry expired at the default TTL although a longer TTL is configured")
	}
	if s.ExpireResolved(base.Add(customTTL - time.Nanosecond)) {
		t.Fatal("entry expired before its configured deadline")
	}
	if !s.ExpireResolved(base.Add(customTTL)) || len(s.Get()) != 0 {
		t.Fatal("entry not expired at its configured deadline")
	}
}

func TestResolvedBuffer_CustomTTL_Seed(t *testing.T) {
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	s := NewAlertStore(customTTL)
	s.now = func() time.Time { return now }
	s.SeedResolved([]models.EnrichedAlert{
		resolvedAlertAt("inside", "a", now.Add(-customTTL+time.Nanosecond)),
		resolvedAlertAt("outside", "a", now.Add(-customTTL)),
	})
	got := s.Get()
	if len(got) != 1 || got[0].Fingerprint != "inside" {
		t.Fatalf("seeded = %v, want only inside", fingerprints(got))
	}
}

func TestRecorder_SeedResolved_UsesConfiguredTTL(t *testing.T) {
	rec, _ := newTestRecorder(t)
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	rec.now = func() time.Time { return now }
	rec.alertStore = NewAlertStore(customTTL)
	rec.alertStore.now = rec.now
	insertResolvedTestEvent(t, rec.store, "recent", "a", models.EventStatusResolved, now.Add(-40*time.Minute))
	insertResolvedTestEvent(t, rec.store, "old", "a", models.EventStatusResolved, now.Add(-customTTL-time.Minute))

	if n := rec.seedResolved(t.Context()); n != 1 {
		t.Fatalf("seeded = %d, want 1", n)
	}
	got := rec.alertStore.Get()
	if len(got) != 1 || got[0].Fingerprint != "recent" {
		t.Fatalf("store = %v, want only recent (40 min old, inside the 1h TTL)", fingerprints(got))
	}
}

func TestFollower_CustomTTL_SweepAndRebuild(t *testing.T) {
	rec, _ := newTestRecorder(t)
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	rec.now = func() time.Time { return now }
	rec.alertStore = NewAlertStore(customTTL)
	rec.alertStore.now = rec.now
	resolvedAt := now.Add(-30 * time.Minute) // beyond the default TTL, inside the custom one
	rec.followerSnapshots = map[string]followerSnapshotEntry{
		"a": {alerts: []models.EnrichedAlert{resolvedAlertAt("r", "a", resolvedAt)}, takenAt: now},
	}
	rec.rebuildFollowerAlertStore()
	if got := rec.alertStore.Get(); len(got) != 1 {
		t.Fatalf("rebuild dropped an entry inside the configured TTL: %v", fingerprints(got))
	}
	if rec.sweepResolved(now) {
		t.Fatal("sweep removed an entry inside the configured TTL")
	}
	if !rec.sweepResolved(resolvedAt.Add(customTTL)) {
		t.Fatal("sweep kept an entry at its configured deadline")
	}
	if got := rec.alertStore.Get(); len(got) != 0 {
		t.Fatalf("store after sweep = %v, want empty", fingerprints(got))
	}
}

func TestFollower_ApplySnapshotRow_UsesConfiguredTTL(t *testing.T) {
	rec, _ := newTestRecorder(t)
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	rec.now = func() time.Time { return now }
	rec.alertStore = NewAlertStore(customTTL)
	payload, err := encodeSnapshot(pollSnapshot{Alerts: []models.EnrichedAlert{
		resolvedAlertAt("r", "a", now.Add(-30*time.Minute)),
	}})
	if err != nil {
		t.Fatal(err)
	}
	rec.applySnapshotRow("a", snapshotRow{Payload: payload, TakenAt: now})
	rec.followerMu.Lock()
	n := len(rec.followerSnapshots["a"].alerts)
	rec.followerMu.Unlock()
	if n != 1 {
		t.Fatalf("cached alerts = %d, want 1 (inside the configured TTL)", n)
	}
}

func TestDefaultResolvedBufferTTL_MatchesConfigDefault(t *testing.T) {
	// config cannot import history (history depends on config through cluster), so the
	// two defaults are pinned to each other here.
	if config.DefaultResolvedBufferTTL != DefaultResolvedBufferTTL {
		t.Fatalf("config default %v != history default %v", config.DefaultResolvedBufferTTL, DefaultResolvedBufferTTL)
	}
}

func TestNewAlertStoreFromConfig_UsesConfiguredTTL(t *testing.T) {
	if got := NewAlertStoreFromConfig(&config.Config{ResolvedBufferTTL: 2 * time.Hour}).ResolvedTTL(); got != 2*time.Hour {
		t.Fatalf("ResolvedTTL() = %v, want 2h", got)
	}
	if got := NewAlertStoreFromConfig(&config.Config{}).ResolvedTTL(); got != DefaultResolvedBufferTTL {
		t.Fatalf("ResolvedTTL() with unset config = %v, want default", got)
	}
}
