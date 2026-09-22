package globalsettings

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"

	idb "github.com/kj187/jarvis/backend/internal/db"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	database, dialect, err := idb.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := idb.Migrate(database, dialect); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return NewStore(database, dialect)
}

func TestGet_MissingSection_ReturnsNilNotFound(t *testing.T) {
	s := newTestStore(t)
	s.Register("known", nil)

	got, err := s.Get(context.Background(), "known")
	if err != nil {
		t.Fatalf("Get() error: %v", err)
	}
	if got != nil {
		t.Fatalf("Get() = %+v, want nil for a section with no stored row", got)
	}
}

func TestSet_ThenGet_RoundTrips(t *testing.T) {
	s := newTestStore(t)
	s.Register("known", nil)

	value := json.RawMessage(`{"foo":"bar"}`)
	if err := s.Set(context.Background(), "known", value, "alice"); err != nil {
		t.Fatalf("Set() error: %v", err)
	}

	got, err := s.Get(context.Background(), "known")
	if err != nil {
		t.Fatalf("Get() error: %v", err)
	}
	if got == nil {
		t.Fatal("Get() = nil, want the stored setting")
	}
	if string(got.Value) != string(value) {
		t.Errorf("Value = %s, want %s", got.Value, value)
	}
	if got.UpdatedBy != "alice" {
		t.Errorf("UpdatedBy = %q, want %q", got.UpdatedBy, "alice")
	}
	if got.UpdatedAt.IsZero() {
		t.Error("UpdatedAt is zero, want a timestamp")
	}
}

// TestSet_Overwrites confirms a second Set() replaces the row (last write
// wins, no merge) — the same contract as the existing user_settings store.
func TestSet_Overwrites(t *testing.T) {
	s := newTestStore(t)
	s.Register("known", nil)

	if err := s.Set(context.Background(), "known", json.RawMessage(`{"v":1}`), "alice"); err != nil {
		t.Fatalf("first Set() error: %v", err)
	}
	if err := s.Set(context.Background(), "known", json.RawMessage(`{"v":2}`), "bob"); err != nil {
		t.Fatalf("second Set() error: %v", err)
	}

	got, err := s.Get(context.Background(), "known")
	if err != nil {
		t.Fatalf("Get() error: %v", err)
	}
	if string(got.Value) != `{"v":2}` {
		t.Errorf("Value = %s, want {\"v\":2}", got.Value)
	}
	if got.UpdatedBy != "bob" {
		t.Errorf("UpdatedBy = %q, want bob", got.UpdatedBy)
	}
}

// TestSet_UnregisteredSection_ReturnsErrNotRegistered is the store-level half
// of "a PUT on an unregistered section is rejected" — Phase 0 registers no
// section at all, so every Set() must fail closed until a feature (Phase 1's
// "access") registers itself.
func TestSet_UnregisteredSection_ReturnsErrNotRegistered(t *testing.T) {
	s := newTestStore(t)

	err := s.Set(context.Background(), "unknown", json.RawMessage(`{}`), "alice")
	if !errors.Is(err, ErrSectionNotRegistered) {
		t.Fatalf("Set() error = %v, want ErrSectionNotRegistered", err)
	}
}

func TestSet_ValidationError_Propagates(t *testing.T) {
	s := newTestStore(t)
	boom := errors.New("boom")
	s.Register("validated", func(json.RawMessage) error { return boom })

	err := s.Set(context.Background(), "validated", json.RawMessage(`{}`), "alice")
	if !errors.Is(err, boom) {
		t.Fatalf("Set() error = %v, want to wrap %v", err, boom)
	}

	// A failed validation must not write the row.
	got, getErr := s.Get(context.Background(), "validated")
	if getErr != nil {
		t.Fatalf("Get() error: %v", getErr)
	}
	if got != nil {
		t.Fatal("Get() returned a row after a validation error, want none")
	}
}

func TestRegistered(t *testing.T) {
	s := newTestStore(t)
	if s.Registered("access") {
		t.Fatal("Registered(access) = true before any Register() call")
	}
	s.Register("access", nil)
	if !s.Registered("access") {
		t.Fatal("Registered(access) = false after Register()")
	}
}

// TestSections_EmptyByDefault documents Phase 0's deliberate simplification:
// no section is registered yet, so the admin UI must see an empty list and
// render its empty state (Sam's scope decision, item 2).
func TestSections_EmptyByDefault(t *testing.T) {
	s := newTestStore(t)
	if got := s.Sections(); len(got) != 0 {
		t.Fatalf("Sections() = %v, want empty", got)
	}
}

func TestSections_ListsRegistered(t *testing.T) {
	s := newTestStore(t)
	s.Register("b", nil)
	s.Register("a", nil)

	got := s.Sections()
	want := []string{"a", "b"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("Sections() = %v, want %v (sorted)", got, want)
	}
}

// TestSet_ThenGet_RoundTrips_PostgreSQL is the PostgreSQL-backed twin of
// TestSet_ThenGet_RoundTrips and TestSet_Overwrites: the SQLite-only
// in-memory tests above never exercise rebind()'s $N placeholders, the
// ON CONFLICT (key) DO UPDATE upsert, or scanning a TIMESTAMPTZ column back
// into time.Time — all PostgreSQL-only code paths. Same env-gate as
// internal/users (CI sets JARVIS_TEST_POSTGRES_DSN); skips locally without a
// test PostgreSQL running (`make up-postgres`).
func TestSet_ThenGet_RoundTrips_PostgreSQL(t *testing.T) {
	dsn := os.Getenv("JARVIS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("JARVIS_TEST_POSTGRES_DSN not set — skipping PostgreSQL-backed test")
	}
	database, dialect, err := idb.Open(dsn)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	// Twice: the migration must be idempotent on an already-migrated database.
	for i := 0; i < 2; i++ {
		if err := idb.Migrate(database, dialect); err != nil {
			t.Fatalf("migrate #%d: %v", i+1, err)
		}
	}

	s := NewStore(database, dialect)
	ctx := context.Background()
	section := "pg-roundtrip-" + t.Name()
	t.Cleanup(func() { _, _ = database.ExecContext(ctx, `DELETE FROM global_settings WHERE key = $1`, section) })
	s.Register(section, nil)

	// First Set: exercises the INSERT branch of ON CONFLICT DO UPDATE.
	if err := s.Set(ctx, section, json.RawMessage(`{"v":1}`), "alice"); err != nil {
		t.Fatalf("first Set() error: %v", err)
	}
	got, err := s.Get(ctx, section)
	if err != nil {
		t.Fatalf("Get() error: %v", err)
	}
	if got == nil {
		t.Fatal("Get() = nil, want the stored setting")
	}
	if string(got.Value) != `{"v":1}` {
		t.Errorf("Value = %s, want {\"v\":1}", got.Value)
	}
	if got.UpdatedBy != "alice" {
		t.Errorf("UpdatedBy = %q, want alice", got.UpdatedBy)
	}
	if got.UpdatedAt.IsZero() {
		t.Error("UpdatedAt is zero, want a TIMESTAMPTZ scanned back into time.Time")
	}

	// Second Set on the same key: exercises the UPDATE branch (ON CONFLICT).
	if err := s.Set(ctx, section, json.RawMessage(`{"v":2}`), "bob"); err != nil {
		t.Fatalf("second Set() error: %v", err)
	}
	got2, err := s.Get(ctx, section)
	if err != nil {
		t.Fatalf("Get() (after update) error: %v", err)
	}
	if string(got2.Value) != `{"v":2}` {
		t.Errorf("Value = %s, want {\"v\":2} after ON CONFLICT update", got2.Value)
	}
	if got2.UpdatedBy != "bob" {
		t.Errorf("UpdatedBy = %q, want bob after ON CONFLICT update", got2.UpdatedBy)
	}
}
