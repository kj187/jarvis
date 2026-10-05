package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func sessionCookieSecure(t *testing.T, xfp string) bool {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/auth/login", nil)
	if xfp != "" {
		req.Header.Set("X-Forwarded-Proto", xfp)
	}
	rec := httptest.NewRecorder()
	SetSessionCookie(echo.New().NewContext(req, rec), "tok")
	for _, c := range rec.Result().Cookies() {
		if c.Name == SessionCookieName {
			return c.Secure
		}
	}
	t.Fatal("no session cookie set")
	return false
}

func TestSessionCookie_SecureAuto(t *testing.T) {
	SetCookieSecure(false)
	if sessionCookieSecure(t, "") {
		t.Error("auto mode over plain http: Secure must be false")
	}
	if !sessionCookieSecure(t, "https") {
		t.Error("auto mode behind a TLS-terminating proxy (X-Forwarded-Proto: https): Secure must be true")
	}
}

func TestSessionCookie_SecureForced(t *testing.T) {
	SetCookieSecure(true)
	t.Cleanup(func() { SetCookieSecure(false) })
	if !sessionCookieSecure(t, "") {
		t.Error("JARVIS_COOKIE_SECURE=true: Secure must be true even without X-Forwarded-Proto")
	}
}
