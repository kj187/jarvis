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
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/metrics"
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

	return NewServer(alertStore, history.NewSilenceStore(), store, hub, registry, cfg, nil, provider, userStore, fanout.NoopFanout{}), userStore
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
