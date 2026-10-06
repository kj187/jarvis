package auth

import (
	"errors"
	"net/http"

	"github.com/labstack/echo/v4"
)

const cookieName = "jarvis_session"

// RequireAuth extracts and validates the JWT from the jarvis_session cookie.
// In "none" mode all requests pass through without authentication.
// On failure: 401 {"error": "unauthorized"}.
// On success: sets the User in context under ContextKey.
func RequireAuth(provider Provider) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if provider.Mode() == "none" {
				return next(c)
			}
			user, err := userFromCookie(c, provider)
			if err != nil {
				return authFailure(c, err)
			}
			c.Set(ContextKey, user)
			return next(c)
		}
	}
}

// OptionalAuth tries to resolve the caller from the session cookie and, if
// valid, sets the User in context under ContextKey exactly like RequireAuth
// — but never rejects the request when the cookie is absent or invalid; the
// handler sees a nil UserFromContext instead. For routes that must answer
// both anonymous and authenticated callers with a different body (e.g.
// GET /api/v1/settings), not just gate write access.
func OptionalAuth(provider Provider) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if provider.Mode() == "none" {
				return next(c)
			}
			if user, err := userFromCookie(c, provider); err == nil {
				c.Set(ContextKey, user)
			}
			return next(c)
		}
	}
}

// RequireAdmin calls RequireAuth then checks role == "admin".
// On failure: 403 {"error": "forbidden"}.
func RequireAdmin(provider Provider) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			user, err := userFromCookie(c, provider)
			if err != nil {
				return authFailure(c, err)
			}
			if user.Role != "admin" {
				return c.JSON(http.StatusForbidden, map[string]string{"error": "forbidden"})
			}
			c.Set(ContextKey, user)
			return next(c)
		}
	}
}

// UserFromContext extracts the authenticated user from Echo's context.
// Returns nil when the request is unauthenticated.
func UserFromContext(c echo.Context) *User {
	u, _ := c.Get(ContextKey).(*User)
	return u
}

// userFromCookie resolves the caller from the session cookie through the
// installed SessionVerifier. Without one (or without a cookie) nobody is
// authenticated.
func userFromCookie(c echo.Context, _ Provider) (*User, error) {
	v := activeVerifier.Load()
	if v == nil {
		return nil, ErrInvalidSession
	}
	cookie, err := c.Cookie(cookieName)
	if err != nil {
		return nil, ErrInvalidSession
	}
	return v.Verify(c.Request().Context(), cookie.Value)
}

// authFailure answers a failed session resolution: 503 when the user store was
// unreachable, 401 otherwise.
func authFailure(c echo.Context, err error) error {
	if errors.Is(err, ErrSessionUnavailable) {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": "service unavailable"})
	}
	return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
}
