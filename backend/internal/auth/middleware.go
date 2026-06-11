package auth

import (
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
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			}
			c.Set(ContextKey, user)
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
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
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

// userFromCookie reads the jarvis_session cookie, looks up the secret key from
// the provider's associated secret (passed via closure), and validates the JWT.
// This function is overridden in tests via a package-level variable.
var userFromCookie = func(c echo.Context, provider Provider) (*User, error) {
	// Secret key is injected via SetSecretKey at startup.
	return nil, echo.NewHTTPError(http.StatusUnauthorized)
}

// SetSecretKey wires the JWT secret key into the cookie-validation closure.
// Must be called once at startup before any requests are served.
func SetSecretKey(key []byte) {
	userFromCookie = func(c echo.Context, _ Provider) (*User, error) {
		cookie, err := c.Cookie(cookieName)
		if err != nil {
			return nil, err
		}
		return ValidateToken(key, cookie.Value)
	}
}
