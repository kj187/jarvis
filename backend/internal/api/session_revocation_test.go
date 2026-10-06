package api

import (
	"context"
	"database/sql"
	"embed"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

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

// revocationEnv is a full router on a real database. Calling start again on the
// same database simulates a restart: every in-memory structure is rebuilt.
type revocationEnv struct {
	t        *testing.T
	database *sql.DB
	dialect  idb.Dialect
	store    *users.Store
}

func newRevocationEnv(t *testing.T) *revocationEnv {
	t.Helper()
	database, dialect, err := idb.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := idb.Migrate(database, dialect); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return &revocationEnv{t: t, database: database, dialect: dialect, store: users.NewStore(database, dialect)}
}

func (e *revocationEnv) start(cacheTTL time.Duration) *httptest.Server {
	return e.startMode("write_protect", cacheTTL)
}

func (e *revocationEnv) startMode(authMode string, cacheTTL time.Duration) *httptest.Server {
	e.t.Helper()
	prev := sessionCacheTTL
	sessionCacheTTL = cacheTTL
	e.t.Cleanup(func() { sessionCacheTTL = prev })

	provider := auth.NewInternalProvider(e.store)
	hub := ws.NewHub(nil, nil, metrics.New("revocation-test"))
	go hub.Run()
	cfg := &config.Config{AuthProvider: "internal", AuthMode: authMode, SecretKey: testSecretKey}
	router := NewRouter(&history.AlertStore{}, history.NewSilenceStore(), history.NewStore(e.database, e.dialect), hub,
		cluster.NewRegistry(nil), cfg, embed.FS{}, &fakeTriggerer{}, provider, e.store,
		settings.NewStore(e.database, e.dialect), globalsettings.NewStore(e.database, e.dialect),
		metrics.New("revocation-test"), fanout.NoopFanout{})
	ts := httptest.NewServer(router)
	e.t.Cleanup(ts.Close)
	return ts
}

func (e *revocationEnv) addUser(username, role string) *users.User {
	e.t.Helper()
	hash, err := auth.HashPassword("a-long-enough-password")
	if err != nil {
		e.t.Fatalf("hash: %v", err)
	}
	u, err := e.store.Create(context.Background(), &users.CreateUser{
		Username: username, Role: role, Provider: "internal", PasswordHash: hash,
	})
	if err != nil {
		e.t.Fatalf("create user: %v", err)
	}
	return u
}

func (e *revocationEnv) cookie(u *users.User) *http.Cookie {
	e.t.Helper()
	tok, err := auth.CreateToken(testSecretKey, &auth.User{
		ID: u.ID, Username: u.Username, Role: u.Role, Provider: u.Provider, TokenVersion: u.TokenVersion,
	})
	if err != nil {
		e.t.Fatalf("create token: %v", err)
	}
	return &http.Cookie{Name: auth.SessionCookieName, Value: tok} // #nosec G124 -- request cookie, Secure/HttpOnly/SameSite only matter on Set-Cookie
}

func do(t *testing.T, ts *httptest.Server, method, path string, ck *http.Cookie) int {
	t.Helper()
	req, _ := http.NewRequestWithContext(context.Background(), method, ts.URL+path, nil)
	if ck != nil {
		req.AddCookie(ck)
	}
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	_ = resp.Body.Close()
	return resp.StatusCode
}

func waitForStatus(t *testing.T, ts *httptest.Server, method, path string, ck *http.Cookie, want int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	got := 0
	for time.Now().Before(deadline) {
		if got = do(t, ts, method, path, ck); got == want {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("%s %s = %d, want %d", method, path, got, want)
}

func TestSession_DeletedUserLosesAccessAfterCacheTTL(t *testing.T) {
	env := newRevocationEnv(t)
	ts := env.start(50 * time.Millisecond)
	u := env.addUser("alice", "user")
	ck := env.cookie(u)

	if got := do(t, ts, http.MethodGet, "/auth/me", ck); got != http.StatusOK {
		t.Fatalf("before delete: /auth/me = %d, want 200", got)
	}
	// Deleted behind this pod's back (as another replica would).
	if err := env.store.Delete(context.Background(), u.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	waitForStatus(t, ts, http.MethodGet, "/auth/me", ck, http.StatusUnauthorized)
}

func TestSession_AdminDeletingUserCutsAccessImmediately(t *testing.T) {
	env := newRevocationEnv(t)
	ts := env.start(time.Hour) // the cache must not be what makes this work
	admin := env.addUser("root", "admin")
	victim := env.addUser("bob", "user")

	if got := do(t, ts, http.MethodGet, "/auth/me", env.cookie(victim)); got != http.StatusOK {
		t.Fatalf("before delete: /auth/me = %d, want 200", got)
	}
	if got := do(t, ts, http.MethodDelete, "/api/v1/admin/users/"+victim.ID, env.cookie(admin)); got != http.StatusNoContent {
		t.Fatalf("delete user = %d, want 204", got)
	}
	if got := do(t, ts, http.MethodGet, "/auth/me", env.cookie(victim)); got != http.StatusUnauthorized {
		t.Fatalf("after delete: /auth/me = %d, want 401", got)
	}
}

func TestSession_DemotedAdminLosesAdminRoutes(t *testing.T) {
	env := newRevocationEnv(t)
	ts := env.start(50 * time.Millisecond)
	u := env.addUser("carol", "admin")
	ck := env.cookie(u) // the token still says role=admin

	if got := do(t, ts, http.MethodGet, "/api/v1/admin/users", ck); got != http.StatusOK {
		t.Fatalf("as admin: %d, want 200", got)
	}
	if err := env.store.UpdateRole(context.Background(), u.ID, "user"); err != nil {
		t.Fatalf("demote: %v", err)
	}
	waitForStatus(t, ts, http.MethodGet, "/api/v1/admin/users", ck, http.StatusForbidden)
}

func TestSession_PromotedUserGainsNothingFromOldToken(t *testing.T) {
	env := newRevocationEnv(t)
	ts := env.start(50 * time.Millisecond)
	u := env.addUser("dave", "user")
	ck := env.cookie(u)
	if err := env.store.UpdateRole(context.Background(), u.ID, "admin"); err != nil {
		t.Fatalf("promote: %v", err)
	}
	// The role comes from the database, not from the token: a promotion applies
	// without a new login.
	waitForStatus(t, ts, http.MethodGet, "/api/v1/admin/users", ck, http.StatusOK)
}

func TestSession_LogoutRevokesTokenAcrossRestart(t *testing.T) {
	env := newRevocationEnv(t)
	ts := env.start(time.Hour)
	u := env.addUser("erin", "user")
	ck := env.cookie(u)

	if got := do(t, ts, http.MethodGet, "/auth/me", ck); got != http.StatusOK {
		t.Fatalf("before logout: /auth/me = %d, want 200", got)
	}
	if got := do(t, ts, http.MethodPost, "/auth/logout", ck); got != http.StatusOK {
		t.Fatalf("logout = %d, want 200", got)
	}
	if got := do(t, ts, http.MethodGet, "/auth/me", ck); got != http.StatusUnauthorized {
		t.Fatalf("after logout: /auth/me = %d, want 401", got)
	}

	// New router, same database: no in-memory revocation list survives.
	restarted := env.start(time.Hour)
	if got := do(t, restarted, http.MethodGet, "/auth/me", ck); got != http.StatusUnauthorized {
		t.Fatalf("after restart: replayed token /auth/me = %d, want 401", got)
	}

	// A fresh login gets a token of the new version and works.
	fresh := env.cookie(mustGetUser(t, env.store, u.ID))
	if got := do(t, restarted, http.MethodGet, "/auth/me", fresh); got != http.StatusOK {
		t.Fatalf("fresh token /auth/me = %d, want 200", got)
	}
}

func mustGetUser(t *testing.T, s *users.Store, id string) *users.User {
	t.Helper()
	u, err := s.GetByID(context.Background(), id)
	if err != nil || u == nil {
		t.Fatalf("get user: %v %v", u, err)
	}
	return u
}

func TestSession_LogoutWithoutSessionIsUnauthorized(t *testing.T) {
	env := newRevocationEnv(t)
	ts := env.start(time.Hour)

	if got := do(t, ts, http.MethodPost, "/auth/logout", nil); got != http.StatusUnauthorized {
		t.Fatalf("logout without cookie = %d, want 401", got)
	}
	garbage := &http.Cookie{Name: auth.SessionCookieName, Value: "not-a-jwt"} // #nosec G124 -- request cookie, Secure/HttpOnly/SameSite only matter on Set-Cookie
	if got := do(t, ts, http.MethodPost, "/auth/logout", garbage); got != http.StatusUnauthorized {
		t.Fatalf("logout with garbage cookie = %d, want 401", got)
	}
}

func TestSession_LogoutClosesOpenWebSocket(t *testing.T) {
	env := newRevocationEnv(t)
	ts := env.start(time.Hour)
	u := env.addUser("frank", "user")
	ck := env.cookie(u)

	conn := dialWS(t, ts, ck)
	defer func() { _ = conn.Close() }()

	if got := do(t, ts, http.MethodPost, "/auth/logout", ck); got != http.StatusOK {
		t.Fatalf("logout = %d, want 200", got)
	}
	assertWSClosed(t, conn)
}

func TestSession_UserDeletionClosesOpenWebSocket(t *testing.T) {
	env := newRevocationEnv(t)
	ts := env.start(time.Hour)
	admin := env.addUser("root", "admin")
	victim := env.addUser("grace", "user")

	conn := dialWS(t, ts, env.cookie(victim))
	defer func() { _ = conn.Close() }()

	if got := do(t, ts, http.MethodDelete, "/api/v1/admin/users/"+victim.ID, env.cookie(admin)); got != http.StatusNoContent {
		t.Fatalf("delete user = %d, want 204", got)
	}
	assertWSClosed(t, conn)
}

func dialWS(t *testing.T, ts *httptest.Server, ck *http.Cookie) *websocket.Conn {
	t.Helper()
	h := http.Header{}
	h.Add("Cookie", ck.String())
	conn, resp, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", h)
	if err != nil {
		t.Fatalf("dial ws: %v", err)
	}
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	return conn
}

// assertWSClosed reads until the server ends the connection. Snapshot and
// heartbeat frames that arrive first are skipped.
func assertWSClosed(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			if ne, ok := err.(interface{ Timeout() bool }); ok && ne.Timeout() {
				t.Fatal("websocket still open after revocation")
			}
			return
		}
	}
}
