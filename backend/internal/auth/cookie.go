package auth

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

const (
	SessionCookieName   = "jarvis_session"
	OIDCStateCookieName = "jarvis_oidc_state"
	sessionMaxAge       = 86400 // 24 h
)

// isSecure returns true when the request was received over HTTPS.
// Checks X-Forwarded-Proto first, then falls back to JARVIS_TLS env flag.
func isSecure(c echo.Context) bool {
	if c.Request().Header.Get("X-Forwarded-Proto") == "https" {
		return true
	}
	return c.Scheme() == "https"
}

// SetSessionCookie writes the jarvis_session cookie.
func SetSessionCookie(c echo.Context, token string) {
	c.SetCookie(&http.Cookie{ // #nosec G124 -- Secure set dynamically via isSecure()
		Name:     SessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isSecure(c),
		MaxAge:   sessionMaxAge,
	})
}

// ClearSessionCookie deletes the jarvis_session cookie.
func ClearSessionCookie(c echo.Context) {
	c.SetCookie(&http.Cookie{ // #nosec G124 -- Secure set dynamically via isSecure()
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isSecure(c),
		MaxAge:   -1,
	})
}

// SetOIDCStateCookie writes the short-lived PKCE state cookie.
func SetOIDCStateCookie(c echo.Context, value string) {
	c.SetCookie(&http.Cookie{ // #nosec G124 -- Secure set dynamically via isSecure()
		Name:     OIDCStateCookieName,
		Value:    value,
		Path:     "/auth/oidc/callback",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isSecure(c),
		MaxAge:   600,
		Expires:  time.Now().Add(10 * time.Minute),
	})
}

// ClearOIDCStateCookie deletes the PKCE state cookie.
func ClearOIDCStateCookie(c echo.Context) {
	c.SetCookie(&http.Cookie{ // #nosec G124 -- Secure set dynamically via isSecure()
		Name:     OIDCStateCookieName,
		Value:    "",
		Path:     "/auth/oidc/callback",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isSecure(c),
		MaxAge:   -1,
	})
}
