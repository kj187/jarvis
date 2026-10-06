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

// findCookie returns the named cookie from a recorder, failing the test when
// it is missing.
func findCookie(t *testing.T, rec *httptest.ResponseRecorder, name string) *http.Cookie {
	t.Helper()
	for _, c := range rec.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("cookie %q not set", name)
	return nil
}

// The session and OIDC-state cookies carry the credential and the PKCE state:
// HttpOnly keeps them from scripts, SameSite=Lax from cross-site POSTs, and
// Secure (behind TLS) from plain-HTTP leaks. Each flag is asserted on its own
// so dropping any one of them fails a test.
func TestCookies_SecurityAttributes(t *testing.T) {
	SetCookieSecure(false)

	cases := []struct {
		name     string
		set      func(echo.Context)
		cookie   string
		wantPath string
	}{
		{"session set", func(c echo.Context) { SetSessionCookie(c, "tok") }, SessionCookieName, "/"},
		{"session clear", ClearSessionCookie, SessionCookieName, "/"},
		{"oidc state set", func(c echo.Context) { SetOIDCStateCookie(c, "state") }, OIDCStateCookieName, "/auth/oidc/callback"},
		{"oidc state clear", ClearOIDCStateCookie, OIDCStateCookieName, "/auth/oidc/callback"},
	}
	for _, tc := range cases {
		for _, https := range []bool{false, true} {
			name := tc.name + " over http"
			if https {
				name = tc.name + " behind https proxy"
			}
			t.Run(name, func(t *testing.T) {
				req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/auth/login", nil)
				if https {
					req.Header.Set("X-Forwarded-Proto", "https")
				}
				rec := httptest.NewRecorder()
				tc.set(echo.New().NewContext(req, rec))

				c := findCookie(t, rec, tc.cookie)
				if !c.HttpOnly {
					t.Error("HttpOnly must be set")
				}
				if c.SameSite != http.SameSiteLaxMode {
					t.Errorf("SameSite = %v, want Lax", c.SameSite)
				}
				if c.Path != tc.wantPath {
					t.Errorf("Path = %q, want %q", c.Path, tc.wantPath)
				}
				if c.Secure != https {
					t.Errorf("Secure = %v, want %v", c.Secure, https)
				}
			})
		}
	}
}
