package api

import (
	"net/http"
	"regexp"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/users"
)

var usernameRe = regexp.MustCompile(`^[a-zA-Z0-9_.\-]{3,64}$`)

// setupRequest is the JSON body for POST /setup.
type setupRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// postSetup creates the first admin user (first-run wizard).
// Returns 403 if users already exist.
func (s *Server) postSetup(c echo.Context) error {
	if s.authProvider.Mode() != "internal" {
		return echo.NewHTTPError(http.StatusNotFound, "setup not available")
	}
	ctx := c.Request().Context()

	// Guard: check DB on every call (no in-memory flag).
	n, err := s.userStore.Count(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "database error")
	}
	if n > 0 {
		return echo.NewHTTPError(http.StatusForbidden, "setup already completed")
	}

	var req setupRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request")
	}

	if !usernameRe.MatchString(req.Username) {
		return echo.NewHTTPError(http.StatusBadRequest, "username must be 3–64 alphanumeric characters, underscores, dots, or hyphens")
	}
	if len(req.Password) < 12 {
		return echo.NewHTTPError(http.StatusBadRequest, "password must be at least 12 characters")
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "password hashing failed")
	}

	_, err = s.userStore.Create(ctx, &users.CreateUser{
		Username:     req.Username,
		Role:         "admin",
		Provider:     "internal",
		PasswordHash: hash,
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create user")
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// firstRunRedirect is a middleware that redirects to /setup when no users exist
// and the auth provider is "internal".
func (s *Server) firstRunRedirect(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		if s.authProvider.Mode() != "internal" {
			return next(c)
		}
		if isSkippedPath(c.Request().URL.Path) {
			return next(c)
		}
		ctx := c.Request().Context()
		n, err := s.userStore.Count(ctx)
		if err != nil || n > 0 {
			return next(c)
		}
		return c.Redirect(http.StatusFound, "/setup")
	}
}

// isSkippedPath returns true for paths that should never be subject to the
// first-run redirect: API routes, auth routes, WebSocket, static assets.
func isSkippedPath(path string) bool {
	switch path {
	case "/setup", "/health", "/ws", "/favicon.ico":
		return true
	}
	for _, prefix := range []string{"/api", "/auth", "/assets"} {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	// Static asset: path contains a file extension (e.g. .js, .css, .png)
	if dot := strings.LastIndex(path, "."); dot > 0 && !strings.Contains(path[dot:], "/") {
		return true
	}
	return false
}
