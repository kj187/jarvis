package auth_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/users"
)

type fakeLookup struct {
	mu    sync.Mutex
	users map[string]*users.User
	err   error
	calls int
}

func (f *fakeLookup) GetByID(_ context.Context, id string) (*users.User, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return f.users[id], nil
}

func (f *fakeLookup) set(u *users.User) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if u == nil {
		return
	}
	f.users[u.ID] = u
}

func (f *fakeLookup) remove(id string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.users, id)
}

func (f *fakeLookup) setErr(err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.err = err
}

func (f *fakeLookup) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func newVerifier(ttl time.Duration, us ...*users.User) (*auth.SessionVerifier, *fakeLookup) {
	l := &fakeLookup{users: map[string]*users.User{}}
	for _, u := range us {
		l.users[u.ID] = u
	}
	return auth.NewSessionVerifier(testKey, l, ttl), l
}

func tokenFor(t *testing.T, u *users.User) string {
	t.Helper()
	tok, err := auth.CreateToken(testKey, &auth.User{
		ID: u.ID, Username: u.Username, Role: u.Role, Provider: u.Provider, TokenVersion: u.TokenVersion,
	})
	if err != nil {
		t.Fatalf("create token: %v", err)
	}
	return tok
}

func TestSessionVerifier_ValidSessionTakesRoleFromDatabase(t *testing.T) {
	u := &users.User{ID: "u1", Username: "alice", Email: "a@x", Role: "admin", Provider: "internal"}
	v, _ := newVerifier(time.Minute, u)
	tok := tokenFor(t, u)

	// The user was demoted after the token was issued.
	v2, l := newVerifier(time.Minute, &users.User{ID: "u1", Username: "alice", Email: "a@x", Role: "user", Provider: "internal"})
	_ = l

	got, err := v.Verify(context.Background(), tok)
	if err != nil || got.Role != "admin" {
		t.Fatalf("admin verify = %+v, %v", got, err)
	}
	got, err = v2.Verify(context.Background(), tok)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if got.Role != "user" {
		t.Fatalf("role = %q, want the database role user, not the token's admin", got.Role)
	}
	if got.Email != "a@x" {
		t.Fatalf("email = %q, want it from the database", got.Email)
	}
}

func TestSessionVerifier_DeletedUserIsInvalid(t *testing.T) {
	u := &users.User{ID: "u1", Username: "alice", Role: "user", Provider: "internal"}
	v, _ := newVerifier(time.Minute)
	if _, err := v.Verify(context.Background(), tokenFor(t, u)); !errors.Is(err, auth.ErrInvalidSession) {
		t.Fatalf("err = %v, want ErrInvalidSession", err)
	}
}

func TestSessionVerifier_TokenVersion(t *testing.T) {
	u := &users.User{ID: "u1", Username: "alice", Role: "user", Provider: "internal", TokenVersion: 0}
	v, l := newVerifier(0, u)
	old := tokenFor(t, u)
	if _, err := v.Verify(context.Background(), old); err != nil {
		t.Fatalf("version 0 token must be valid: %v", err)
	}

	l.set(&users.User{ID: "u1", Username: "alice", Role: "user", Provider: "internal", TokenVersion: 1})
	if _, err := v.Verify(context.Background(), old); !errors.Is(err, auth.ErrInvalidSession) {
		t.Fatalf("stale token after bump: err = %v, want ErrInvalidSession", err)
	}
	fresh := tokenFor(t, &users.User{ID: "u1", Username: "alice", Role: "user", Provider: "internal", TokenVersion: 1})
	if _, err := v.Verify(context.Background(), fresh); err != nil {
		t.Fatalf("token of the current version must be valid: %v", err)
	}
}

func TestSessionVerifier_BadSignatureIsInvalidNotUnavailable(t *testing.T) {
	v, l := newVerifier(time.Minute)
	l.setErr(errors.New("db down"))
	if _, err := v.Verify(context.Background(), "garbage"); !errors.Is(err, auth.ErrInvalidSession) {
		t.Fatalf("err = %v, want ErrInvalidSession", err)
	}
	if l.callCount() != 0 {
		t.Fatal("an unparsable token must not reach the database")
	}
}

func TestSessionVerifier_CachesAndInvalidates(t *testing.T) {
	u := &users.User{ID: "u1", Username: "alice", Role: "user", Provider: "internal"}
	v, l := newVerifier(time.Hour, u)
	tok := tokenFor(t, u)
	for i := 0; i < 3; i++ {
		if _, err := v.Verify(context.Background(), tok); err != nil {
			t.Fatalf("verify: %v", err)
		}
	}
	if l.callCount() != 1 {
		t.Fatalf("lookups = %d, want 1 (cached)", l.callCount())
	}

	l.remove("u1")
	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("still cached, must verify: %v", err)
	}
	v.Invalidate("u1")
	if _, err := v.Verify(context.Background(), tok); !errors.Is(err, auth.ErrInvalidSession) {
		t.Fatalf("after Invalidate: err = %v, want ErrInvalidSession", err)
	}
}

func TestSessionVerifier_CacheExpires(t *testing.T) {
	u := &users.User{ID: "u1", Username: "alice", Role: "user", Provider: "internal"}
	v, l := newVerifier(30*time.Millisecond, u)
	tok := tokenFor(t, u)
	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("verify: %v", err)
	}
	l.remove("u1")
	time.Sleep(60 * time.Millisecond)
	if _, err := v.Verify(context.Background(), tok); !errors.Is(err, auth.ErrInvalidSession) {
		t.Fatalf("after ttl: err = %v, want ErrInvalidSession", err)
	}
}

func TestSessionVerifier_DatabaseErrors(t *testing.T) {
	u := &users.User{ID: "u1", Username: "alice", Role: "user", Provider: "internal"}
	v, l := newVerifier(20*time.Millisecond, u)
	tok := tokenFor(t, u)

	l.setErr(errors.New("db down"))
	if _, err := v.Verify(context.Background(), tok); !errors.Is(err, auth.ErrSessionUnavailable) {
		t.Fatalf("cold cache + db error: err = %v, want ErrSessionUnavailable", err)
	}

	l.setErr(nil)
	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("verify: %v", err)
	}
	l.setErr(errors.New("db down"))
	time.Sleep(40 * time.Millisecond) // entry is now stale
	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("a stale entry must keep serving during a db outage: %v", err)
	}
}

func TestSessionVerifier_StillValid(t *testing.T) {
	u := &users.User{ID: "u1", Username: "alice", Role: "user", Provider: "internal", TokenVersion: 2}
	v, l := newVerifier(0, u)
	if !v.StillValid(context.Background(), "u1", 2) {
		t.Fatal("matching version must be valid")
	}
	if v.StillValid(context.Background(), "u1", 1) {
		t.Fatal("older version must be invalid")
	}
	l.remove("u1")
	if v.StillValid(context.Background(), "u1", 2) {
		t.Fatal("deleted user must be invalid")
	}
	cold, cl := newVerifier(0, u)
	cl.setErr(errors.New("db down"))
	if !cold.StillValid(context.Background(), "u1", 2) {
		t.Fatal("a lookup error must fail open for established streams")
	}
}
