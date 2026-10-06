package api

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/kj187/jarvis/backend/internal/auth"
)

// GET /auth/info — returns provider mode, login URL, and whether first-run setup is needed.
func (s *Server) getAuthInfo(c echo.Context) error {
	info := s.authProvider.Info()
	info.AuthMode = s.cfg.AuthMode
	info.RunbookBaseURL = s.cfg.RunbookBaseURL
	if info.Mode == "internal" {
		n, err := s.userStore.Count(c.Request().Context())
		if err == nil && n == 0 {
			info.SetupRequired = true
			info.SetupTokenRequired = s.cfg.SetupToken != ""
		}
	}
	return c.JSON(http.StatusOK, info)
}

// GET /auth/me — returns the authenticated user or 401.
//
// The session token carries no e-mail or groups, so an SSO user's record is read
// from the database: e-mail always, and — when the instance names a groups claim
// (JARVIS_OIDC_GROUPS_CLAIM) — the claim name, the groups stored at the last
// login and that login's time, so the Account dialog can show what the IdP told
// Jarvis. Only the caller's own record is ever returned. These extras are
// cosmetic: when the lookup fails the session fields are still returned, because
// any non-200 makes the frontend treat a valid session as signed out.
func (s *Server) getAuthMe(c echo.Context) error {
	u := auth.UserFromContext(c)
	if u == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
	}
	body := map[string]any{
		"id":       u.ID,
		"username": u.Username,
		"role":     u.Role,
		"provider": u.Provider,
	}
	if u.Provider == "oidc" {
		stored, err := s.userStore.GetByID(c.Request().Context(), u.ID)
		if err != nil {
			slog.Error("auth/me: load user record", "err", err)
			stored = nil
		}
		if stored != nil {
			if stored.Email != "" {
				body["email"] = stored.Email
			}
			if s.cfg.OIDCGroupsClaim != "" {
				groups := stored.Groups
				if groups == nil {
					groups = []string{}
				}
				body["groupsClaim"] = s.cfg.OIDCGroupsClaim
				body["groups"] = groups
				if stored.LastLoginAt != nil {
					body["lastLoginAt"] = stored.LastLoginAt.UTC().Format(time.RFC3339)
				}
			}
		}
	}
	return c.JSON(http.StatusOK, body)
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

	// The wait applies to every submitted username, existing or not, so the
	// response never reveals whether an account exists.
	if wait := s.loginThrottle.Wait(req.Username); wait > 0 {
		c.Response().Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
		return c.JSON(http.StatusTooManyRequests, map[string]string{"error": "too many failed attempts, try again later"})
	}

	u, err := s.authProvider.Authenticate(c.Request().Context(), req.Username, req.Password)
	if err != nil {
		s.loginThrottle.Fail(req.Username)
		// Always return the same message to prevent user enumeration.
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
	}
	s.loginThrottle.Succeed(req.Username)

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

// POST /auth/logout — ends the session for good: the user's token version is
// bumped, which invalidates this token and every other one issued before (on
// every replica), and the user's open WebSocket connections are closed. The
// route requires a valid session; without one there is nothing to end.
func (s *Server) postLogout(c echo.Context) error {
	if u := auth.UserFromContext(c); u != nil {
		if err := s.userStore.BumpTokenVersion(c.Request().Context(), u.ID); err != nil {
			// The cookie is still dropped; the token just stays valid until it expires.
			slog.Error("logout: bump token version", "err", err)
			auth.ClearSessionCookie(c)
			return echo.NewHTTPError(http.StatusInternalServerError)
		}
		auth.InvalidateUser(u.ID)
		s.hub.CloseUser(u.ID)
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

	// Remember where to send the browser afterwards: ?popup=1 (login in a popup
	// window that then closes) or ?return_to=<in-app path> (full-page redirect back
	// to the page the user came from). Both live in the state cookie, so the IdP
	// round trip needs no server-side state.
	popup := c.QueryParam("popup") == "1"
	returnTo := sanitizeReturnTo(c.QueryParam("return_to"))
	auth.SetOIDCStateCookie(c, encodeOIDCState(state, codeVerifier, popup, returnTo))

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

	cookieState, codeVerifier, landing, ok := decodeOIDCState(cookie.Value)
	if !ok {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid state cookie")
	}

	// Constant-time state comparison to prevent timing attacks.
	if subtle.ConstantTimeCompare([]byte(stateParam), []byte(cookieState)) != 1 {
		return echo.NewHTTPError(http.StatusBadRequest, "state mismatch")
	}

	u, err := s.authProvider.Exchange(c.Request().Context(), code, codeVerifier)
	if err != nil {
		slog.Error("oidc callback exchange failed", "err", err)
		return echo.NewHTTPError(http.StatusUnauthorized, "authentication failed")
	}
	auth.InvalidateUser(u.ID) // the IdP groups may have changed the role

	tok, err := auth.CreateToken(s.cfg.SecretKey, u)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError)
	}
	auth.SetSessionCookie(c, tok)

	return c.Redirect(http.StatusFound, landing)
}
