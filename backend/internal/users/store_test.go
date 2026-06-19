package users_test

import (
	"context"
	"testing"

	"github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/users"
)

func newTestStore(t *testing.T) *users.Store {
	t.Helper()
	database, dialect, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.Migrate(database, dialect); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return users.NewStore(database, dialect)
}

func TestCreate_GetByID(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	u, err := s.Create(ctx, &users.CreateUser{
		Username:     "alice",
		Email:        "alice@example.com",
		PasswordHash: "$2a$12$hash",
		Role:         "admin",
		Provider:     "internal",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if u.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if u.Username != "alice" {
		t.Fatalf("username = %q, want %q", u.Username, "alice")
	}
	if u.Role != "admin" {
		t.Fatalf("role = %q, want %q", u.Role, "admin")
	}

	got, err := s.GetByID(ctx, u.ID)
	if err != nil {
		t.Fatalf("get by id: %v", err)
	}
	if got == nil || got.Username != "alice" {
		t.Fatal("expected alice by id")
	}
}

func TestGetByUsername(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	_, _ = s.Create(ctx, &users.CreateUser{Username: "bob", Role: "user", Provider: "internal"})

	got, err := s.GetByUsername(ctx, "bob")
	if err != nil {
		t.Fatalf("get by username: %v", err)
	}
	if got == nil || got.Username != "bob" {
		t.Fatal("expected bob")
	}

	missing, err := s.GetByUsername(ctx, "nobody")
	if err != nil {
		t.Fatalf("err for missing: %v", err)
	}
	if missing != nil {
		t.Fatal("expected nil for unknown user")
	}
}

func TestUpsertOIDCUser(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	u1, err := s.UpsertOIDCUser(ctx, "sub-123", "charlie", "charlie@example.com", "user")
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if u1.OIDCSub != "sub-123" {
		t.Fatalf("oidc_sub = %q, want %q", u1.OIDCSub, "sub-123")
	}

	// Second upsert returns same record.
	u2, err := s.UpsertOIDCUser(ctx, "sub-123", "charlie", "charlie@example.com", "user")
	if err != nil {
		t.Fatalf("upsert2: %v", err)
	}
	if u1.ID != u2.ID {
		t.Fatalf("expected same user, got %q vs %q", u1.ID, u2.ID)
	}

	// Role update on re-login.
	u3, err := s.UpsertOIDCUser(ctx, "sub-123", "charlie", "charlie@example.com", "admin")
	if err != nil {
		t.Fatalf("upsert3: %v", err)
	}
	if u3.Role != "admin" {
		t.Fatalf("role = %q, want %q", u3.Role, "admin")
	}
}

func TestUpsertOIDCUser_UsernameCollision(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	if _, err := s.Create(ctx, &users.CreateUser{
		Username: "julian.kleinhans",
		Role:     "admin",
		Provider: "internal",
	}); err != nil {
		t.Fatalf("create internal user: %v", err)
	}

	u, err := s.UpsertOIDCUser(ctx, "oidc-sub-1", "julian.kleinhans", "julian@example.com", "user")
	if err != nil {
		t.Fatalf("upsert oidc user: %v", err)
	}
	if u.Username != "julian.kleinhans-oidc" {
		t.Fatalf("username = %q, want %q", u.Username, "julian.kleinhans-oidc")
	}
}

func TestCount(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	n, _ := s.Count(ctx)
	if n != 0 {
		t.Fatalf("count = %d, want 0", n)
	}
	_, _ = s.Create(ctx, &users.CreateUser{Username: "dave", Role: "user", Provider: "internal"})
	n, _ = s.Count(ctx)
	if n != 1 {
		t.Fatalf("count = %d, want 1", n)
	}
}

func TestDelete(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	u, _ := s.Create(ctx, &users.CreateUser{Username: "eve", Role: "user", Provider: "internal"})
	if err := s.Delete(ctx, u.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	got, _ := s.GetByID(ctx, u.ID)
	if got != nil {
		t.Fatal("expected nil after delete")
	}
}

func TestUpdateRole(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	u, _ := s.Create(ctx, &users.CreateUser{Username: "frank", Role: "user", Provider: "internal"})
	if err := s.UpdateRole(ctx, u.ID, "admin"); err != nil {
		t.Fatalf("update role: %v", err)
	}
	got, _ := s.GetByID(ctx, u.ID)
	if got.Role != "admin" {
		t.Fatalf("role = %q, want admin", got.Role)
	}
}

func TestList(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	_, _ = s.Create(ctx, &users.CreateUser{Username: "grace", Role: "user", Provider: "internal"})
	_, _ = s.Create(ctx, &users.CreateUser{Username: "henry", Role: "user", Provider: "internal"})

	list, err := s.List(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("list len = %d, want 2", len(list))
	}
}
