package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/fanout"
	"github.com/kj187/jarvis/backend/internal/globalsettings"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/metrics"
	"github.com/kj187/jarvis/backend/internal/settings"
	"github.com/kj187/jarvis/backend/internal/users"
	"github.com/kj187/jarvis/backend/internal/ws"
)

var testSecretKey = []byte("aaaabbbbccccddddeeeeffffgggghhhh")

func newAuthServer(t *testing.T) (*Server, *users.Store) {
	t.Helper()
	database, dialect, err := idb.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := idb.Migrate(database, dialect); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	auth.SetSecretKey(testSecretKey)

	userStore := users.NewStore(database, dialect)
	provider := auth.NewInternalProvider(userStore)
	alertStore := &history.AlertStore{}
	store := history.NewStore(database, dialect)
	hub := ws.NewHub(nil, nil, metrics.New("test"))
	go hub.Run()
	registry := cluster.NewRegistry(nil)
	cfg := &config.Config{AuthProvider: "internal", SecretKey: testSecretKey}
	settingsStore := settings.NewStore(database, dialect)
	globalSettingsStore := globalsettings.NewStore(database, dialect)

	return NewServer(alertStore, history.NewSilenceStore(), store, hub, registry, cfg, nil, provider, userStore, settingsStore, globalSettingsStore, fanout.NoopFanout{}), userStore
}

func createTestUser(t *testing.T, store *users.Store, username, password, role string) *users.User {
	t.Helper()
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	u, err := store.Create(context.Background(), &users.CreateUser{
		Username:     username,
		Role:         role,
		Provider:     "internal",
		PasswordHash: hash,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	return u
}

func TestGetAuthInfo(t *testing.T) {
	srv, _ := newAuthServer(t)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/auth/info", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	_ = srv.getAuthInfo(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "internal") {
		t.Fatalf("expected mode=internal in: %s", rec.Body.String())
	}
}

func TestPostLogin_Success(t *testing.T) {
	srv, store := newAuthServer(t)
	createTestUser(t, store, "alice", "securepassword123!", "user")

	body, _ := json.Marshal(map[string]string{"username": "alice", "password": "securepassword123!"})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/auth/login", bytes.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)

	_ = srv.postLogin(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", rec.Code, rec.Body.String())
	}
	// Check session cookie is set.
	found := false
	for _, h := range rec.Result().Cookies() {
		if h.Name == auth.SessionCookieName {
			found = true
		}
	}
	if !found {
		t.Fatal("jarvis_session cookie not set")
	}
}

func TestPostLogin_WrongPassword(t *testing.T) {
	srv, store := newAuthServer(t)
	createTestUser(t, store, "bob", "correctpassword123!", "user")

	body, _ := json.Marshal(map[string]string{"username": "bob", "password": "wrongpassword123!"})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/auth/login", bytes.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	_ = srv.postLogin(c)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestPostLogout(t *testing.T) {
	srv, _ := newAuthServer(t)
	u := &auth.User{ID: "u-logout", Username: "logout-user", Role: "user", Provider: "internal"}
	tok, err := auth.CreateToken(testSecretKey, u)
	if err != nil {
		t.Fatalf("create token: %v", err)
	}

	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/auth/logout", nil)
	req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: tok})
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	_ = srv.postLogout(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	// Verify cookie is cleared (MaxAge=-1).
	cleared := false
	for _, ck := range rec.Result().Cookies() {
		if ck.Name == auth.SessionCookieName && ck.MaxAge < 0 {
			cleared = true
		}
	}
	if !cleared {
		t.Fatal("expected session cookie to be cleared")
	}
	if _, err := auth.ValidateToken(testSecretKey, tok); err == nil {
		t.Fatal("expected logout to revoke token")
	}
}

func TestGetAuthMe_Authenticated(t *testing.T) {
	srv, _ := newAuthServer(t)
	u := &auth.User{ID: "u1", Username: "carol", Role: "admin", Provider: "internal"}
	tok, _ := auth.CreateToken(testSecretKey, u)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/auth/me", nil)
	req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: tok})
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.Set(auth.ContextKey, u)
	_ = srv.getAuthMe(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "carol") {
		t.Fatalf("expected carol in response: %s", rec.Body.String())
	}
}

// newOIDCAuthServer builds a server whose config names the groups claim, plus
// an OIDC user already stored with the given groups (as a login would leave it).
func newOIDCAuthServer(t *testing.T, groupsClaim string, groups []string) (*Server, *auth.User) {
	t.Helper()
	srv, userStore := newAuthServer(t)
	srv.cfg.AuthProvider = "oidc"
	srv.cfg.OIDCGroupsClaim = groupsClaim
	stored, err := userStore.UpsertOIDCUser(context.Background(), "sub-1", "dana", "dana@example.com", "user", groups)
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if err := userStore.UpdateLastLogin(context.Background(), stored.ID); err != nil {
		t.Fatalf("last login: %v", err)
	}
	// Exactly what ValidateToken yields: the session JWT carries no e-mail.
	return srv, &auth.User{ID: stored.ID, Username: stored.Username, Role: stored.Role, Provider: "oidc"}
}

func getMe(t *testing.T, srv *Server, u *auth.User) map[string]any {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/auth/me", nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.Set(auth.ContextKey, u)
	if err := srv.getAuthMe(c); err != nil {
		t.Fatalf("getAuthMe: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return body
}

func TestGetAuthMe_OIDCReturnsGroupsWhenClaimConfigured(t *testing.T) {
	srv, u := newOIDCAuthServer(t, "cognito:groups", []string{"frontend", "Operator"})

	body := getMe(t, srv, u)

	if body["groupsClaim"] != "cognito:groups" {
		t.Errorf("groupsClaim = %v, want cognito:groups", body["groupsClaim"])
	}
	groups, _ := body["groups"].([]any)
	if len(groups) != 2 || groups[0] != "frontend" || groups[1] != "Operator" {
		t.Errorf("groups = %v, want [frontend Operator]", body["groups"])
	}
	if body["email"] != "dana@example.com" {
		t.Errorf("email = %v, want dana@example.com", body["email"])
	}
	if s, _ := body["lastLoginAt"].(string); s == "" {
		t.Errorf("lastLoginAt missing: %v", body)
	}
}

func TestGetAuthMe_OIDCUserWithoutGroupsGetsEmptyList(t *testing.T) {
	srv, u := newOIDCAuthServer(t, "groups", nil)

	body := getMe(t, srv, u)

	groups, ok := body["groups"].([]any)
	if !ok || len(groups) != 0 {
		t.Errorf("groups = %#v, want an empty list (claim configured, user has none)", body["groups"])
	}
}

func TestGetAuthMe_OIDCWithoutClaimConfiguredHidesGroups(t *testing.T) {
	srv, u := newOIDCAuthServer(t, "", []string{"frontend"})

	body := getMe(t, srv, u)

	if _, present := body["groups"]; present {
		t.Errorf("groups must be absent when JARVIS_OIDC_GROUPS_CLAIM is not set: %v", body)
	}
	if _, present := body["groupsClaim"]; present {
		t.Errorf("groupsClaim must be absent when not configured: %v", body)
	}
	if body["email"] != "dana@example.com" {
		t.Errorf("email = %v, want dana@example.com (from the stored user, not the token)", body["email"])
	}
}

// The groups are cosmetic: a database hiccup must never turn /auth/me into a
// non-200 — the frontend reads that as "signed out" and would drop a valid session.
func TestGetAuthMe_OIDCLookupFailureStillReturnsTheSession(t *testing.T) {
	srv, u := newOIDCAuthServer(t, "groups", []string{"frontend"})
	broken, dialect, err := idb.Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	_ = broken.Close() // every query on this handle now fails
	srv.userStore = users.NewStore(broken, dialect)

	body := getMe(t, srv, u)

	if body["username"] != "dana" || body["role"] != "user" || body["provider"] != "oidc" {
		t.Errorf("session fields missing: %v", body)
	}
	for _, k := range []string{"groups", "groupsClaim", "email", "lastLoginAt"} {
		if _, present := body[k]; present {
			t.Errorf("%s must be omitted when the lookup failed: %v", k, body)
		}
	}
}

func TestGetAuthMe_InternalUserHasNoGroupFields(t *testing.T) {
	srv, _ := newAuthServer(t)
	srv.cfg.OIDCGroupsClaim = "groups" // irrelevant for a local account
	body := getMe(t, srv, &auth.User{ID: "u1", Username: "carol", Role: "admin", Provider: "internal"})

	for _, k := range []string{"groups", "groupsClaim", "lastLoginAt"} {
		if _, present := body[k]; present {
			t.Errorf("%s must be absent for an internal user: %v", k, body)
		}
	}
}

func TestGetAuthMe_Unauthenticated(t *testing.T) {
	srv, _ := newAuthServer(t)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/auth/me", nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	_ = srv.getAuthMe(c)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestPostLogin_SameErrorForUnknownUser(t *testing.T) {
	srv, _ := newAuthServer(t)

	body, _ := json.Marshal(map[string]string{"username": "nobody", "password": "somepassword123!"})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/auth/login", bytes.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	_ = srv.postLogin(c)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}

	var resp map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["error"] != "invalid credentials" {
		t.Fatalf("error = %q, want 'invalid credentials'", resp["error"])
	}
}

func TestGetAuthMe_NoCookie_Returns401(t *testing.T) {
	srv, _ := newAuthServer(t)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/auth/me", nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	_ = srv.getAuthMe(c)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}
