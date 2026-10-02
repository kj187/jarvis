package auth_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/users"
	"github.com/labstack/echo/v4"
)

func setupEcho(t *testing.T) *echo.Echo {
	t.Helper()
	lookup := &fakeLookup{users: map[string]*users.User{
		"u1": {ID: "u1", Username: "alice", Role: "user", Provider: "internal"},
		"u2": {ID: "u2", Username: "bob", Role: "user", Provider: "internal"},
		"u3": {ID: "u3", Username: "carol", Role: "admin", Provider: "internal"},
	}}
	auth.SetSessionVerifier(auth.NewSessionVerifier(testKey, lookup, time.Minute))
	e := echo.New()
	return e
}

func makeSessionCookie(t *testing.T, user *auth.User) *http.Cookie {
	t.Helper()
	tok, err := auth.CreateToken(testKey, user)
	if err != nil {
		t.Fatalf("create token: %v", err)
	}
	return &http.Cookie{Name: "jarvis_session", Value: tok}
}

// RequireAuth — none mode passes through without any cookie
func TestRequireAuth_NoneProvider_PassesThrough(t *testing.T) {
	e := setupEcho(t)
	provider := auth.NoneProvider{}

	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	called := false
	handler := auth.RequireAuth(provider)(func(c echo.Context) error {
		called = true
		return c.NoContent(http.StatusOK)
	})

	if err := handler(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if !called {
		t.Fatal("next handler was not called in none mode")
	}
}

// RequireAuth — JWT validation works end-to-end (CreateToken → ParseToken)
func TestRequireAuth_ValidToken(t *testing.T) {
	tok, err := auth.CreateToken(testKey, &auth.User{ID: "u1", Username: "alice", Role: "user", Provider: "internal"})
	if err != nil {
		t.Fatal(err)
	}
	u, err := auth.ParseToken(testKey, tok)
	if err != nil {
		t.Fatalf("ParseToken: %v", err)
	}
	if u.Username != "alice" {
		t.Errorf("username = %q, want alice", u.Username)
	}
}

// RequireAdmin — user role is denied
func TestRequireAdmin_UserRole(t *testing.T) {
	e := setupEcho(t)
	provider := auth.NoneProvider{}

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	req.AddCookie(makeSessionCookie(t, &auth.User{ID: "u2", Username: "bob", Role: "user", Provider: "internal"}))
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	handler := auth.RequireAdmin(provider)(func(c echo.Context) error {
		t.Fatal("should not reach next handler")
		return nil
	})

	if err := handler(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

// RequireAdmin — admin role is allowed
func TestRequireAdmin_AdminRole(t *testing.T) {
	e := setupEcho(t)
	provider := auth.NoneProvider{}

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	req.AddCookie(makeSessionCookie(t, &auth.User{ID: "u3", Username: "carol", Role: "admin", Provider: "internal"}))
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	called := false
	handler := auth.RequireAdmin(provider)(func(c echo.Context) error {
		called = true
		return c.NoContent(http.StatusOK)
	})

	if err := handler(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if !called {
		t.Fatal("next handler was not called for admin")
	}
}

// RequireAuth — a revoked or unknown session is 401, an unreachable user store 503
func TestRequireAuth_SessionFailures(t *testing.T) {
	provider := auth.NewInternalProvider(nil)
	run := func(lookup *fakeLookup, cookie *http.Cookie) int {
		auth.SetSessionVerifier(auth.NewSessionVerifier(testKey, lookup, time.Minute))
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
		if cookie != nil {
			req.AddCookie(cookie)
		}
		rec := httptest.NewRecorder()
		c := echo.New().NewContext(req, rec)
		_ = auth.RequireAuth(provider)(func(echo.Context) error {
			t.Fatal("next must not run")
			return nil
		})(c)
		return rec.Code
	}
	ck := makeSessionCookie(t, &auth.User{ID: "u9", Username: "x", Role: "user", Provider: "internal"})

	if got := run(&fakeLookup{users: map[string]*users.User{}}, ck); got != http.StatusUnauthorized {
		t.Errorf("deleted user: %d, want 401", got)
	}
	if got := run(&fakeLookup{users: map[string]*users.User{}}, nil); got != http.StatusUnauthorized {
		t.Errorf("no cookie: %d, want 401", got)
	}
	if got := run(&fakeLookup{users: map[string]*users.User{}, err: errors.New("db down")}, ck); got != http.StatusServiceUnavailable {
		t.Errorf("db down: %d, want 503", got)
	}
}
