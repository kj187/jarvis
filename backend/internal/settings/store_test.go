package settings_test

import (
	"context"
	"testing"

	"github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/settings"
	"github.com/kj187/jarvis/backend/internal/users"
)

func newTestStore(t *testing.T) (*settings.Store, *users.Store) {
	t.Helper()
	database, dialect, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.Migrate(database, dialect); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return settings.NewStore(database, dialect), users.NewStore(database, dialect)
}

func TestGet_UnknownUser(t *testing.T) {
	s, _ := newTestStore(t)
	got, err := s.Get(context.Background(), "no-such-user")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got != "" {
		t.Fatalf("got = %q, want empty string", got)
	}
}

func TestPut_Get(t *testing.T) {
	s, userStore := newTestStore(t)
	ctx := context.Background()
	u, err := userStore.Create(ctx, &users.CreateUser{Username: "alice", Role: "user", Provider: "internal"})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	if err := s.Put(ctx, u.ID, `{"theme":"light"}`); err != nil {
		t.Fatalf("put: %v", err)
	}
	got, err := s.Get(ctx, u.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got != `{"theme":"light"}` {
		t.Fatalf("got = %q, want %q", got, `{"theme":"light"}`)
	}
}

func TestPut_Upsert(t *testing.T) {
	s, userStore := newTestStore(t)
	ctx := context.Background()
	u, err := userStore.Create(ctx, &users.CreateUser{Username: "bob", Role: "user", Provider: "internal"})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	if err := s.Put(ctx, u.ID, `{"theme":"light"}`); err != nil {
		t.Fatalf("put 1: %v", err)
	}
	if err := s.Put(ctx, u.ID, `{"theme":"dark"}`); err != nil {
		t.Fatalf("put 2: %v", err)
	}
	got, err := s.Get(ctx, u.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got != `{"theme":"dark"}` {
		t.Fatalf("got = %q, want %q (last write should win, no duplicate row)", got, `{"theme":"dark"}`)
	}
}

func TestDelete(t *testing.T) {
	s, userStore := newTestStore(t)
	ctx := context.Background()
	u, err := userStore.Create(ctx, &users.CreateUser{Username: "carol", Role: "user", Provider: "internal"})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if err := s.Put(ctx, u.ID, `{"theme":"light"}`); err != nil {
		t.Fatalf("put: %v", err)
	}

	if err := s.Delete(ctx, u.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	got, err := s.Get(ctx, u.ID)
	if err != nil {
		t.Fatalf("get after delete: %v", err)
	}
	if got != "" {
		t.Fatalf("got = %q, want empty string after delete", got)
	}

	// Deleting an unknown user is a no-op, not an error.
	if err := s.Delete(ctx, "no-such-user"); err != nil {
		t.Fatalf("delete unknown user: %v", err)
	}
}

func TestCascadeOnUserDelete(t *testing.T) {
	s, userStore := newTestStore(t)
	ctx := context.Background()
	u, err := userStore.Create(ctx, &users.CreateUser{Username: "dave", Role: "user", Provider: "internal"})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if err := s.Put(ctx, u.ID, `{"theme":"light"}`); err != nil {
		t.Fatalf("put: %v", err)
	}

	if err := userStore.Delete(ctx, u.ID); err != nil {
		t.Fatalf("delete user: %v", err)
	}

	got, err := s.Get(ctx, u.ID)
	if err != nil {
		t.Fatalf("get after user cascade delete: %v", err)
	}
	if got != "" {
		t.Fatalf("got = %q, want empty string after user cascade delete", got)
	}
}
