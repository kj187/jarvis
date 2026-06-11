package api

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"log/slog"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/kj187/jarvis/backend/internal/auth"
)

// GET /auth/info — returns provider mode, login URL, and whether first-run setup is needed.
func (s *Server) getAuthInfo(c echo.Context) error {
	info := s.authProvider.Info()
	if info.Mode == "internal" {
		n, err := s.userStore.Count(c.Request().Context())
		if err == nil && n == 0 {
			info.SetupRequired = true
		}
	}
	return c.JSON(http.StatusOK, info)
}

// GET /auth/me — returns the authenticated user or 401.
func (s *Server) getAuthMe(c echo.Context) error {
	u := auth.UserFromContext(c)
	if u == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
	}
	return c.JSON(http.StatusOK, map[string]string{
		"id":       u.ID,
		"username": u.Username,
		"role":     u.Role,
		"provider": u.Provider,
	})
}

// loginRequest is the JSON body for POST /auth/login.
type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// POST /auth/login — validates internal credentials and sets a session cookie.
func (s *Server) postLogin(c echo.Context) error {
	var req loginRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request")
	}

	u, err := s.authProvider.Authenticate(c.Request().Context(), req.Username, req.Password)
	if err != nil {
		// Always return the same message to prevent user enumeration.
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
	}

	tok, err := auth.CreateToken(s.cfg.SecretKey, u)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "token creation failed")
	}
	auth.SetSessionCookie(c, tok)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"user": map[string]string{
			"id":       u.ID,
			"username": u.Username,
			"role":     u.Role,
		},
	})
}

// POST /auth/logout — clears the session cookie.
func (s *Server) postLogout(c echo.Context) error {
	if s.authProvider.Mode() != "none" && len(s.cfg.SecretKey) > 0 {
		if cookie, err := c.Cookie(auth.SessionCookieName); err == nil && cookie.Value != "" {
			_ = auth.RevokeToken(s.cfg.SecretKey, cookie.Value)
		}
	}
	auth.ClearSessionCookie(c)
	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// GET /auth/oidc/start — initiates PKCE OIDC flow.
func (s *Server) getOIDCStart(c echo.Context) error {
	// Generate code_verifier (32 random bytes, base64url-encoded).
	verifierBytes := make([]byte, 32)
	if _, err := rand.Read(verifierBytes); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError)
	}
	codeVerifier := base64.RawURLEncoding.EncodeToString(verifierBytes)

	// code_challenge = base64url(sha256(code_verifier)).
	h := sha256.Sum256([]byte(codeVerifier))
	codeChallenge := base64.RawURLEncoding.EncodeToString(h[:])

	// Generate state (16 random bytes).
	stateBytes := make([]byte, 16)
	if _, err := rand.Read(stateBytes); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError)
	}
	state := base64.RawURLEncoding.EncodeToString(stateBytes)

	// Store state|codeVerifier in cookie (pipe-separated, both already base64url).
	auth.SetOIDCStateCookie(c, state+"|"+codeVerifier)

	return c.Redirect(http.StatusFound, s.authProvider.AuthURL(state, codeChallenge))
}

// GET /auth/oidc/callback — handles the OIDC redirect callback.
func (s *Server) getOIDCCallback(c echo.Context) error {
	code := c.QueryParam("code")
	stateParam := c.QueryParam("state")
	if code == "" || stateParam == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "missing code or state")
	}

	// Read and delete the state cookie.
	cookie, err := c.Cookie(auth.OIDCStateCookieName)
	auth.ClearOIDCStateCookie(c)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "missing state cookie")
	}

	parts := strings.SplitN(cookie.Value, "|", 2)
	if len(parts) != 2 {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid state cookie")
	}
	cookieState, codeVerifier := parts[0], parts[1]

	// Constant-time state comparison to prevent timing attacks.
	if subtle.ConstantTimeCompare([]byte(stateParam), []byte(cookieState)) != 1 {
		return echo.NewHTTPError(http.StatusBadRequest, "state mismatch")
	}

	u, err := s.authProvider.Exchange(c.Request().Context(), code, codeVerifier)
	if err != nil {
		slog.Error("oidc callback exchange failed", "err", err)
		return echo.NewHTTPError(http.StatusUnauthorized, "authentication failed")
	}

	tok, err := auth.CreateToken(s.cfg.SecretKey, u)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError)
	}
	auth.SetSessionCookie(c, tok)

	return c.Redirect(http.StatusFound, "/")
}
