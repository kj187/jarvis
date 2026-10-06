package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

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
	srv, store := newAuthServer(t)
	u := createTestUser(t, store, "logout-user", "pw-long-enough-1", "user")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/auth/logout", nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.Set(auth.ContextKey, &auth.User{ID: u.ID, Username: u.Username, Role: u.Role, Provider: u.Provider})
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
	got, err := store.GetByID(context.Background(), u.ID)
	if err != nil || got == nil {
		t.Fatalf("get user: %v %v", got, err)
	}
	if got.TokenVersion != 1 {
		t.Fatalf("TokenVersion = %d, want 1 (logout must revoke the session)", got.TokenVersion)
	}
}

func TestGetAuthMe_Authenticated(t *testing.T) {
	srv, _ := newAuthServer(t)
	u := &auth.User{ID: "u1", Username: "carol", Role: "admin", Provider: "internal"}
	tok, _ := auth.CreateToken(testSecretKey, u)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/auth/me", nil)
	req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: tok}) // #nosec G124 -- request cookie, Secure/HttpOnly/SameSite only matter on Set-Cookie
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
	// getAuthMe reads e-mail and groups from the store, so the caller needs no e-mail.
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

func postLoginAs(t *testing.T, srv *Server, username, password string) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"username": username, "password": password})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/auth/login", bytes.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e := echo.New()
	c := e.NewContext(req, rec)
	if err := srv.postLogin(c); err != nil {
		e.HTTPErrorHandler(err, c)
	}
	return rec
}

func TestPostLogin_RepeatedFailuresThrottleOnlyThatUser(t *testing.T) {
	srv, store := newAuthServer(t)
	createTestUser(t, store, "alice", "correctpassword123!", "user")
	createTestUser(t, store, "bob", "correctpassword123!", "user")

	for i := 0; i < 10; i++ {
		postLoginAs(t, srv, "alice", "wrong-password-1!")
	}

	locked := postLoginAs(t, srv, "alice", "correctpassword123!")
	if locked.Code != http.StatusTooManyRequests {
		t.Fatalf("alice with the right password while throttled: status = %d, want 429", locked.Code)
	}
	if locked.Header().Get("Retry-After") == "" {
		t.Error("429 without Retry-After")
	}
	if ok := postLoginAs(t, srv, "bob", "correctpassword123!"); ok.Code != http.StatusOK {
		t.Fatalf("bob status = %d, want 200 (a throttled alice must not affect bob)", ok.Code)
	}
}

func TestPostLogin_ThrottleDoesNotRevealWhetherTheAccountExists(t *testing.T) {
	srv, store := newAuthServer(t)
	createTestUser(t, store, "alice", "correctpassword123!", "user")

	for i := 0; i < 10; i++ {
		postLoginAs(t, srv, "alice", "wrong-password-1!")
		postLoginAs(t, srv, "ghost", "wrong-password-1!")
	}
	existing := postLoginAs(t, srv, "alice", "wrong-password-1!")
	missing := postLoginAs(t, srv, "ghost", "wrong-password-1!")

	if existing.Code != missing.Code || existing.Body.String() != missing.Body.String() {
		t.Fatalf("responses differ: existing = %d %q, missing = %d %q",
			existing.Code, existing.Body.String(), missing.Code, missing.Body.String())
	}
}

func TestPostLogin_LoginWorksAgainAfterTheWait(t *testing.T) {
	srv, store := newAuthServer(t)
	createTestUser(t, store, "alice", "correctpassword123!", "user")
	now := time.Now()
	srv.loginThrottle.SetClock(func() time.Time { return now })

	for i := 0; i < 10; i++ {
		postLoginAs(t, srv, "alice", "wrong-password-1!")
	}
	if rec := postLoginAs(t, srv, "alice", "correctpassword123!"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 while throttled", rec.Code)
	}
	now = now.Add(time.Hour)
	if rec := postLoginAs(t, srv, "alice", "correctpassword123!"); rec.Code != http.StatusOK {
		t.Fatalf("status after the wait = %d, want 200", rec.Code)
	}
}

// fakeAuthProvider overrides Authenticate; every other Provider method is the
// embedded (nil) interface and must not be reached by the login handler.
type fakeAuthProvider struct {
	auth.Provider
	fn func(ctx context.Context, username, password string) (*auth.User, error)
}

func (f *fakeAuthProvider) Authenticate(ctx context.Context, username, password string) (*auth.User, error) {
	return f.fn(ctx, username, password)
}

func TestPostLogin_ConcurrentAttemptsForOneNameAreSerialized(t *testing.T) {
	srv, _ := newAuthServer(t)
	started := make(chan struct{})
	release := make(chan struct{})
	var mu sync.Mutex
	calls := 0
	srv.authProvider = &fakeAuthProvider{fn: func(context.Context, string, string) (*auth.User, error) {
		mu.Lock()
		calls++
		first := calls == 1
		mu.Unlock()
		if first {
			close(started)
			<-release
		}
		return nil, auth.ErrInvalidCredentials
	}}

	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- postLoginAs(t, srv, "alice", "wrong-password-1!") }()
	<-started

	// A second attempt for the same name while the first is still being
	// checked must not reach the provider.
	rec := postLoginAs(t, srv, "Alice", "wrong-password-2!")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("parallel attempt: status = %d, want 429", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("429 without Retry-After")
	}
	if strings.Contains(rec.Body.String(), "failed attempts") || !strings.Contains(rec.Body.String(), "already in progress") {
		t.Errorf("in-flight 429 body = %s, want a message about a login in progress", rec.Body.String())
	}
	// Another name is not held up.
	if other := postLoginAs(t, srv, "bob", "wrong-password-3!"); other.Code != http.StatusUnauthorized {
		t.Fatalf("other name: status = %d, want 401", other.Code)
	}
	close(release)
	if first := <-done; first.Code != http.StatusUnauthorized {
		t.Fatalf("first attempt: status = %d, want 401", first.Code)
	}
	mu.Lock()
	defer mu.Unlock()
	if calls != 2 { // alice once, bob once
		t.Fatalf("provider calls = %d, want 2", calls)
	}
}

func TestPostLogin_ManyParallelAttemptsAfterTheWaitCheckOnlyOne(t *testing.T) {
	srv, _ := newAuthServer(t)
	now := time.Now()
	var clockMu sync.Mutex
	srv.loginThrottle.SetClock(func() time.Time { clockMu.Lock(); defer clockMu.Unlock(); return now })

	var mu sync.Mutex
	calls := 0
	gate := make(chan struct{})
	srv.authProvider = &fakeAuthProvider{fn: func(context.Context, string, string) (*auth.User, error) {
		mu.Lock()
		calls++
		mu.Unlock()
		<-gate
		return nil, auth.ErrInvalidCredentials
	}}
	// Run the counter up so a lock is active, then let it expire.
	for i := 0; i < 6; i++ {
		srv.loginThrottle.Fail("alice")
	}
	clockMu.Lock()
	now = now.Add(time.Hour)
	clockMu.Unlock()

	const n = 20
	var wg sync.WaitGroup
	codes := make(chan int, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); codes <- postLoginAs(t, srv, "alice", "wrong-password-1!").Code }()
	}
	// All but the one holding the in-flight slot answer 429 right away.
	for i := 0; i < n-1; i++ {
		if c := <-codes; c != http.StatusTooManyRequests {
			t.Fatalf("parallel attempt: status = %d, want 429", c)
		}
	}
	close(gate)
	wg.Wait()
	mu.Lock()
	defer mu.Unlock()
	if calls != 1 {
		t.Fatalf("provider calls = %d, want 1", calls)
	}
}

func TestPostLogin_DatabaseErrorIsNotAFailedAttempt(t *testing.T) {
	srv, _ := newAuthServer(t)
	srv.authProvider = &fakeAuthProvider{fn: func(context.Context, string, string) (*auth.User, error) {
		return nil, errors.New("pq: connection refused to db-host-7:5432")
	}}

	for i := 0; i < 10; i++ {
		rec := postLoginAs(t, srv, "alice", "correctpassword123!")
		if rec.Code == http.StatusTooManyRequests {
			t.Fatalf("attempt %d: throttled by database errors", i+1)
		}
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("attempt %d: status = %d, want 500", i+1, rec.Code)
		}
		if strings.Contains(rec.Body.String(), "db-host-7") || strings.Contains(rec.Body.String(), "pq:") {
			t.Fatalf("response leaks the error detail: %s", rec.Body.String())
		}
	}
	if w := srv.loginThrottle.Wait("alice"); w != 0 {
		t.Fatalf("wait after database errors = %v, want 0", w)
	}
}

func TestPostLogin_ThrottledResponseDoesNotExtendTheWait(t *testing.T) {
	srv, store := newAuthServer(t)
	createTestUser(t, store, "alice", "correctpassword123!", "user")
	now := time.Now()
	srv.loginThrottle.SetClock(func() time.Time { return now })

	for i := 0; i < 6; i++ {
		postLoginAs(t, srv, "alice", "wrong-password-1!")
	}
	before := srv.loginThrottle.Wait("alice")
	if before <= 0 {
		t.Fatal("expected an active wait after 6 failures")
	}
	for i := 0; i < 5; i++ {
		if rec := postLoginAs(t, srv, "alice", "wrong-password-1!"); rec.Code != http.StatusTooManyRequests {
			t.Fatalf("status = %d, want 429", rec.Code)
		}
	}
	if after := srv.loginThrottle.Wait("alice"); after != before {
		t.Fatalf("wait after 429 responses = %v, want unchanged %v", after, before)
	}
}

func TestPostLogin_ProvidersWithoutPasswordLoginAnswer401WithoutErrorLogOrCounting(t *testing.T) {
	providers := map[string]auth.Provider{
		"none": auth.NoneProvider{},
		"oidc": &auth.OIDCProvider{},
	}
	for name, p := range providers {
		t.Run(name, func(t *testing.T) {
			srv, _ := newAuthServer(t)
			srv.authProvider = p
			var buf bytes.Buffer
			prev := slog.Default()
			slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
			t.Cleanup(func() { slog.SetDefault(prev) })

			for i := 0; i < 10; i++ {
				rec := postLoginAs(t, srv, "alice", "whatever-password-1!")
				if rec.Code != http.StatusUnauthorized {
					t.Fatalf("attempt %d: status = %d, want 401", i+1, rec.Code)
				}
				if !strings.Contains(rec.Body.String(), "invalid credentials") {
					t.Fatalf("body = %s, want the generic message", rec.Body.String())
				}
			}
			if buf.Len() != 0 {
				t.Errorf("anonymous login attempt was logged: %s", buf.String())
			}
			if w := srv.loginThrottle.Wait("alice"); w != 0 {
				t.Errorf("wait = %v, want 0 (not a failed attempt)", w)
			}
		})
	}
}

func TestPostLogin_PanicInAuthenticateDoesNotLeaveTheNameReserved(t *testing.T) {
	srv, _ := newAuthServer(t)
	srv.authProvider = &fakeAuthProvider{fn: func(context.Context, string, string) (*auth.User, error) {
		panic("boom")
	}}
	func() {
		defer func() { _ = recover() }()
		postLoginAs(t, srv, "alice", "pw-long-enough-1")
	}()

	srv.authProvider = &fakeAuthProvider{fn: func(context.Context, string, string) (*auth.User, error) {
		return nil, auth.ErrInvalidCredentials
	}}
	if rec := postLoginAs(t, srv, "alice", "pw-long-enough-1"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("after a panic: status = %d, want 401 (name must be usable again)", rec.Code)
	}
}
