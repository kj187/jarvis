package auth_test

import (
	"context"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/users"
)

func newInternalProvider(t *testing.T) (*auth.InternalProvider, *users.Store) {
	t.Helper()
	database, dialect, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.Migrate(database, dialect); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	store := users.NewStore(database, dialect)
	return auth.NewInternalProvider(store), store
}

func TestAuthenticate_CorrectPassword(t *testing.T) {
	p, store := newInternalProvider(t)
	ctx := context.Background()

	hash, err := auth.HashPassword("supersecretpassword!")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	_, err = store.Create(ctx, &users.CreateUser{
		Username:     "alice",
		Role:         "admin",
		Provider:     "internal",
		PasswordHash: hash,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	u, err := p.Authenticate(ctx, "alice", "supersecretpassword!")
	if err != nil {
		t.Fatalf("authenticate: %v", err)
	}
	if u.Username != "alice" {
		t.Fatalf("username = %q, want alice", u.Username)
	}
}

func TestAuthenticate_WrongPassword(t *testing.T) {
	p, store := newInternalProvider(t)
	ctx := context.Background()

	hash, _ := auth.HashPassword("correctpassword123!")
	_, _ = store.Create(ctx, &users.CreateUser{
		Username:     "bob",
		Role:         "user",
		Provider:     "internal",
		PasswordHash: hash,
	})

	_, err := p.Authenticate(ctx, "bob", "wrongpassword123!")
	if err == nil {
		t.Fatal("expected error for wrong password")
	}
}

func TestAuthenticate_UnknownUser(t *testing.T) {
	p, _ := newInternalProvider(t)
	ctx := context.Background()

	// Should not reveal user existence — returns error, not panic.
	_, err := p.Authenticate(ctx, "nobody", "somepassword123!")
	if err == nil {
		t.Fatal("expected error for unknown user")
	}
}

func TestAuthenticate_Timing(t *testing.T) {
	if testing.Short() {
		t.Skip("timing test skipped in short mode")
	}
	p, store := newInternalProvider(t)
	ctx := context.Background()

	hash, _ := auth.HashPassword("validpassword1234!")
	_, _ = store.Create(ctx, &users.CreateUser{
		Username:     "charlie",
		Role:         "user",
		Provider:     "internal",
		PasswordHash: hash,
	})

	// Both code paths should run bcrypt (slow by design ≥1ms).
	t0 := time.Now()
	_, _ = p.Authenticate(ctx, "charlie", "wrongpassword1234!")
	knownUserTime := time.Since(t0)

	t1 := time.Now()
	_, _ = p.Authenticate(ctx, "unknown_xyz", "wrongpassword1234!")
	unknownUserTime := time.Since(t1)

	if knownUserTime < time.Millisecond {
		t.Errorf("known-user path too fast: %v (expected bcrypt cost≥12)", knownUserTime)
	}
	if unknownUserTime < time.Millisecond {
		t.Errorf("unknown-user path too fast: %v (dummy hash should still run bcrypt)", unknownUserTime)
	}
}
