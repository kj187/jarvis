package users_test

import (
	"context"
	"os"
	"strings"
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

	u1, err := s.UpsertOIDCUser(ctx, "sub-123", "charlie", "charlie@example.com", "user", nil)
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if u1.OIDCSub != "sub-123" {
		t.Fatalf("oidc_sub = %q, want %q", u1.OIDCSub, "sub-123")
	}

	// Second upsert returns same record.
	u2, err := s.UpsertOIDCUser(ctx, "sub-123", "charlie", "charlie@example.com", "user", nil)
	if err != nil {
		t.Fatalf("upsert2: %v", err)
	}
	if u1.ID != u2.ID {
		t.Fatalf("expected same user, got %q vs %q", u1.ID, u2.ID)
	}

	// Role update on re-login.
	u3, err := s.UpsertOIDCUser(ctx, "sub-123", "charlie", "charlie@example.com", "admin", nil)
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

	u, err := s.UpsertOIDCUser(ctx, "oidc-sub-1", "julian.kleinhans", "julian@example.com", "user", nil)
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

func TestUpsertOIDCUser_StoresGroups(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	u, err := s.UpsertOIDCUser(ctx, "sub-g", "dana", "dana@example.com", "user", []string{"frontend", "Operator"})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if got := strings.Join(u.Groups, ","); got != "frontend,Operator" {
		t.Fatalf("groups on create = %q, want %q", got, "frontend,Operator")
	}

	got, err := s.GetByID(ctx, u.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if strings.Join(got.Groups, ",") != "frontend,Operator" {
		t.Fatalf("groups after reload = %v, want [frontend Operator]", got.Groups)
	}
}

func TestUpsertOIDCUser_GroupsFollowTheIdPOnEveryLogin(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	u, err := s.UpsertOIDCUser(ctx, "sub-g", "dana", "", "user", []string{"frontend", "sre"})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}

	// The IdP dropped "sre" and added "backend": the next login must replace the set.
	u2, err := s.UpsertOIDCUser(ctx, "sub-g", "dana", "", "user", []string{"frontend", "backend"})
	if err != nil {
		t.Fatalf("upsert2: %v", err)
	}
	if u2.ID != u.ID {
		t.Fatalf("expected the same user, got %q vs %q", u.ID, u2.ID)
	}
	reloaded, _ := s.GetByID(ctx, u.ID)
	if strings.Join(reloaded.Groups, ",") != "frontend,backend" {
		t.Fatalf("groups after re-login = %v, want [frontend backend]", reloaded.Groups)
	}

	// Losing every group must clear them, not keep the stale set.
	if _, err := s.UpsertOIDCUser(ctx, "sub-g", "dana", "", "user", nil); err != nil {
		t.Fatalf("upsert3: %v", err)
	}
	reloaded, _ = s.GetByID(ctx, u.ID)
	if len(reloaded.Groups) != 0 {
		t.Fatalf("groups after losing all = %v, want empty", reloaded.Groups)
	}
}

func TestGroups_InternalUserHasNone(t *testing.T) {
	s := newTestStore(t)
	u, err := s.Create(context.Background(), &users.CreateUser{
		Username: "erin", PasswordHash: "$2a$12$hash", Role: "user", Provider: "internal",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if len(u.Groups) != 0 {
		t.Fatalf("groups = %v, want empty", u.Groups)
	}
}

// The oidc_groups column is added by an ALTER on both dialects; on PostgreSQL
// that path only runs against a real server, so it is env-gated like the other
// PostgreSQL tests (CI sets JARVIS_TEST_POSTGRES_DSN).
func TestUpsertOIDCUser_Groups_PostgreSQL(t *testing.T) {
	dsn := os.Getenv("JARVIS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("JARVIS_TEST_POSTGRES_DSN not set — skipping PostgreSQL-backed test")
	}
	database, dialect, err := db.Open(dsn)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	// Twice: the migration must be idempotent on an already-migrated database.
	for i := 0; i < 2; i++ {
		if err := db.Migrate(database, dialect); err != nil {
			t.Fatalf("migrate #%d: %v", i+1, err)
		}
	}
	s := users.NewStore(database, dialect)
	ctx := context.Background()
	sub := "pg-groups-" + t.Name()
	t.Cleanup(func() { _, _ = database.ExecContext(ctx, `DELETE FROM users WHERE oidc_sub = $1`, sub) })

	u, err := s.UpsertOIDCUser(ctx, sub, "pg-groups-user", "", "user", []string{"a", "b"})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if _, err := s.UpsertOIDCUser(ctx, sub, "pg-groups-user", "", "user", []string{"b", "c"}); err != nil {
		t.Fatalf("upsert2: %v", err)
	}
	got, err := s.GetByID(ctx, u.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if strings.Join(got.Groups, ",") != "b,c" {
		t.Fatalf("groups = %v, want [b c]", got.Groups)
	}
}

func TestUpsertOIDCUser_EmailFollowsTheIdPOnLogin(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	u, err := s.UpsertOIDCUser(ctx, "sub-m", "gina", "gina@old.example", "user", nil)
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}

	// The IdP now reports a new address: the stored one must follow.
	if _, err := s.UpsertOIDCUser(ctx, "sub-m", "gina", "gina@new.example", "user", nil); err != nil {
		t.Fatalf("upsert2: %v", err)
	}
	got, _ := s.GetByID(ctx, u.ID)
	if got.Email != "gina@new.example" {
		t.Fatalf("email = %q, want gina@new.example", got.Email)
	}

	// A token without an e-mail claim must not wipe the address we already know.
	if _, err := s.UpsertOIDCUser(ctx, "sub-m", "gina", "", "user", nil); err != nil {
		t.Fatalf("upsert3: %v", err)
	}
	got, _ = s.GetByID(ctx, u.ID)
	if got.Email != "gina@new.example" {
		t.Fatalf("email after an empty claim = %q, want it kept", got.Email)
	}
}
