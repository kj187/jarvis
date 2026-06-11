package auth_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/kj187/jarvis/backend/internal/auth"
)

func setupEcho(t *testing.T) *echo.Echo {
	t.Helper()
	auth.SetSecretKey(testKey)
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

// RequireAuth — JWT validation works end-to-end (CreateToken → ValidateToken)
func TestRequireAuth_ValidToken(t *testing.T) {
	tok, err := auth.CreateToken(testKey, &auth.User{ID: "u1", Username: "alice", Role: "user", Provider: "internal"})
	if err != nil {
		t.Fatal(err)
	}
	u, err := auth.ValidateToken(testKey, tok)
	if err != nil {
		t.Fatalf("ValidateToken: %v", err)
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
