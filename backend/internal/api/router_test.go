package api

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/fanout"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/metrics"
	"github.com/kj187/jarvis/backend/internal/settings"
	"github.com/kj187/jarvis/backend/internal/users"
	"github.com/kj187/jarvis/backend/internal/ws"
	"github.com/labstack/echo/v4"
)

func newTestRouter(t *testing.T, origins []string) *httptest.Server {
	srv, _ := newTestRouterWithDB(t, origins)
	return srv
}

func newTestRouterWithDB(t *testing.T, origins []string) (*httptest.Server, *sql.DB) {
	t.Helper()
	e, database := newTestEchoWithDB(t, origins)
	return httptest.NewServer(e), database
}

// newTestEchoWithDB builds the router in auth mode "none" and returns the Echo
// instance itself, so tests can drive it via ServeHTTP with a chosen
// RemoteAddr and headers.
func newTestEchoWithDB(t *testing.T, origins []string) (*echo.Echo, *sql.DB) {
	t.Helper()
	database, dialect, err := idb.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := idb.Migrate(database, dialect); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	alertStore := &history.AlertStore{}
	store := history.NewStore(database, dialect)
	userStore := users.NewStore(database, dialect)
	hub := ws.NewHub(nil, nil, metrics.New("test"))
	go hub.Run()
	registry := cluster.NewRegistry(nil)
	cfg := &config.Config{AllowedOrigins: origins}

	e := NewRouter(alertStore, history.NewSilenceStore(), store, hub, registry, cfg, embed.FS{}, &fakeTriggerer{}, auth.NoneProvider{}, userStore, settings.NewStore(database, dialect), metrics.New("test"), fanout.NoopFanout{})
	return e, database
}

// TestRoutes verifies that all registered routes return 200.
// Critical invariant: /api/v1/alerts/groups must not be matched as a fingerprint parameter.
func TestRoutes(t *testing.T) {
	srv := newTestRouter(t, nil)
	defer srv.Close()

	routes := []string{
		"/api/v1/alerts/groups", // must not be interpreted as fingerprint "groups"
		"/api/v1/alerts/resolved",
		"/api/v1/alerts",
		"/api/v1/status",
		"/api/v1/silences",
		"/api/v1/clusters",
		"/health",
		"/metrics",
	}

	var client http.Client
	for _, path := range routes {
		req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+path, nil)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("GET %s = %d, want 200", path, resp.StatusCode)
		}
	}
}

func TestCORS_AllowedOrigin(t *testing.T) {
	srv := newTestRouter(t, []string{"http://allowed.example.com"})
	defer srv.Close()

	req, _ := http.NewRequestWithContext(context.Background(), http.MethodOptions, srv.URL+"/api/v1/alerts", nil)
	req.Header.Set("Origin", "http://allowed.example.com")
	req.Header.Set("Access-Control-Request-Method", "GET")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("preflight request: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	origin := resp.Header.Get("Access-Control-Allow-Origin")
	if origin != "http://allowed.example.com" {
		t.Errorf("CORS origin = %q, want http://allowed.example.com", origin)
	}
}

func TestCORS_NoWildcard(t *testing.T) {
	srv := newTestRouter(t, []string{"http://allowed.example.com"})
	defer srv.Close()

	req, _ := http.NewRequestWithContext(context.Background(), http.MethodOptions, srv.URL+"/api/v1/alerts", nil)
	req.Header.Set("Origin", "http://evil.example.com")
	req.Header.Set("Access-Control-Request-Method", "GET")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("preflight request: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	origin := resp.Header.Get("Access-Control-Allow-Origin")
	if origin == "*" {
		t.Error("CORS wildcard must never be returned")
	}
	if origin == "http://evil.example.com" {
		t.Error("unauthorized origin must not be echoed in CORS header")
	}
}

func TestCORS_NoCORSConfigured(t *testing.T) {
	srv := newTestRouter(t, nil) // no allowed origins → CORS middleware not added
	defer srv.Close()

	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+"/health", nil)
	req.Header.Set("Origin", "http://whatever.example.com")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
}

func TestTriggerPoll_NilTrigger(t *testing.T) {
	srv, _ := newTestServer(t)
	e := newTestRouter(t, nil)
	defer e.Close()

	// pollTrigger is nil in newTestServer — should return 204 without panic
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, e.URL+"/api/v1/poll", nil)
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST /poll: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	_ = srv // suppress unused warning
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("status = %d, want 204", resp.StatusCode)
	}
}

func TestSetupRoute_NotRegisteredInNoneMode(t *testing.T) {
	srv := newTestRouter(t, nil)
	defer srv.Close()

	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, srv.URL+"/setup", nil)
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST /setup: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", resp.StatusCode)
	}
}

func newTestRouterWithAuthMode(t *testing.T, authMode string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(newTestEchoInternal(t, authMode))
}

// newTestEchoInternal builds the router with the internal auth provider and
// returns the Echo instance for ServeHTTP-driven tests.
func newTestEchoInternal(t *testing.T, authMode string) *echo.Echo {
	t.Helper()
	database, dialect, err := idb.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := idb.Migrate(database, dialect); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	auth.SetSecretKey([]byte("aaaabbbbccccddddeeeeffffgggghhhh"))

	userStore := users.NewStore(database, dialect)
	provider := auth.NewInternalProvider(userStore)
	alertStore := &history.AlertStore{}
	store := history.NewStore(database, dialect)
	hub := ws.NewHub(nil, nil, metrics.New("test"))
	go hub.Run()
	registry := cluster.NewRegistry(nil)
	cfg := &config.Config{
		AuthProvider: "internal",
		AuthMode:     authMode,
		SecretKey:    []byte("aaaabbbbccccddddeeeeffffgggghhhh"),
	}

	return NewRouter(alertStore, history.NewSilenceStore(), store, hub, registry, cfg, embed.FS{}, &fakeTriggerer{}, provider, userStore, settings.NewStore(database, dialect), metrics.New("test"), fanout.NoopFanout{})
}

func TestMetricsRoute_ExposesBuildInfo(t *testing.T) {
	srv := newTestRouter(t, nil)
	defer srv.Close()

	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+"/metrics", nil)
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET /metrics: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
		t.Errorf("content-type = %q, want text/plain prefix", ct)
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "jarvis_build_info") {
		t.Error("expected jarvis_build_info in /metrics output")
	}
}

func TestMetricsRoute_PublicUnderFullProtect(t *testing.T) {
	srv := newTestRouterWithAuthMode(t, "full_protect")
	defer srv.Close()

	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+"/metrics", nil)
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET /metrics: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200 (no session required)", resp.StatusCode)
	}
}

func TestAuthMode_ReadRoutes(t *testing.T) {
	readRoutes := []string{
		"/api/v1/alerts",
		"/api/v1/alerts/groups",
		"/api/v1/silences",
		"/api/v1/clusters",
		"/api/v1/status",
	}

	cases := []struct {
		mode       string
		wantStatus int
	}{
		{"full_protect", http.StatusUnauthorized},
		{"write_protect", http.StatusOK},
	}

	for _, tc := range cases {
		t.Run(tc.mode, func(t *testing.T) {
			srv := newTestRouterWithAuthMode(t, tc.mode)
			defer srv.Close()

			client := &http.Client{}
			for _, path := range readRoutes {
				req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+path, nil)
				resp, err := client.Do(req)
				if err != nil {
					t.Fatalf("GET %s: %v", path, err)
				}
				_ = resp.Body.Close()
				if resp.StatusCode != tc.wantStatus {
					t.Errorf("GET %s = %d, want %d (%s mode)", path, resp.StatusCode, tc.wantStatus, tc.mode)
				}
			}
		})
	}
}

func TestWebSocket_FullProtectRequiresAuth(t *testing.T) {
	srv := newTestRouterWithAuthMode(t, "full_protect")
	defer srv.Close()
	client := &http.Client{}

	// Without a session cookie the request must be rejected by RequireAuth
	// before reaching the WS handler — /ws streams the full alert snapshot,
	// which is exactly the data full_protect gates.
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+"/ws", nil)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET /ws: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("GET /ws without session = %d, want 401", resp.StatusCode)
	}

	// With a valid session cookie the request must pass the middleware and
	// reach the WS handler: a plain GET without upgrade headers then fails
	// the websocket handshake with 400 — anything but 401 proves passthrough.
	token, err := auth.CreateToken([]byte("aaaabbbbccccddddeeeeffffgggghhhh"), &auth.User{
		ID: "u1", Username: "alice", Role: "user", Provider: "internal",
	})
	if err != nil {
		t.Fatalf("create token: %v", err)
	}
	req2, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+"/ws", nil)
	req2.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
	resp2, err := client.Do(req2)
	if err != nil {
		t.Fatalf("GET /ws with session: %v", err)
	}
	_ = resp2.Body.Close()
	if resp2.StatusCode == http.StatusUnauthorized {
		t.Errorf("GET /ws with valid session = 401, want handler reached (e.g. 400 bad handshake)")
	}
}

func TestWebSocket_WriteProtectStaysPublic(t *testing.T) {
	srv := newTestRouterWithAuthMode(t, "write_protect")
	defer srv.Close()

	// In write_protect mode /ws stays public (read-only data): the request
	// must reach the WS handler, which rejects a non-upgrade GET with 400.
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+"/ws", nil)
	resp, err := (&http.Client{}).Do(req)
	if err != nil {
		t.Fatalf("GET /ws: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		t.Errorf("GET /ws in write_protect = 401, want handler reached (e.g. 400 bad handshake)")
	}
}

// serveFrom sends one request through the router as if it came from the given
// peer address, optionally with a spoofed X-Forwarded-For header.
func serveFrom(e *echo.Echo, method, path, body, remoteAddr, xff string) int {
	req := httptest.NewRequestWithContext(context.Background(), method, path, strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	req.RemoteAddr = remoteAddr
	if xff != "" {
		req.Header.Set(echo.HeaderXForwardedFor, xff)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec.Code
}

// TestLoginRateLimit_IsGlobal: the login limit has one shared bucket, no
// matter which peer address or X-Forwarded-For value a request carries. A
// per-client bucket would be bypassable by rotating X-Forwarded-For.
// A malformed body answers 400 before any bcrypt work, so the test does not
// depend on hashing time. The bounds tolerate token refill during a slow run
// (-race): at least the burst passes, and most of the excess is rejected.
func TestLoginRateLimit_IsGlobal(t *testing.T) {
	e := newTestEchoInternal(t, "write_protect")

	const total = 60
	passed, limited := 0, 0
	for i := 0; i < total; i++ {
		code := serveFrom(e, http.MethodPost, "/auth/login", "{",
			fmt.Sprintf("10.0.%d.%d:4000", i/250, i%250+1),
			fmt.Sprintf("203.0.113.%d", i+1))
		switch code {
		case http.StatusBadRequest:
			passed++
		case http.StatusTooManyRequests:
			limited++
		default:
			t.Fatalf("request %d: status = %d, want 400 or 429", i, code)
		}
	}
	if passed < 10 {
		t.Errorf("passed = %d, want >= burst 10", passed)
	}
	if limited < total/2 {
		t.Errorf("limited = %d of %d, want >= %d (shared bucket across all clients)", limited, total, total/2)
	}
}

// TestNoPerIPRateLimits: Jarvis is an internal tool; only /auth/login is
// rate limited. Poll, setup and the write endpoints must never answer 429.
func TestNoPerIPRateLimits(t *testing.T) {
	none, _ := newTestEchoWithDB(t, nil)
	internal := newTestEchoInternal(t, "write_protect")

	const n = 30
	cases := []struct {
		name         string
		e            *echo.Echo
		method, path string
	}{
		{"poll", none, http.MethodPost, "/api/v1/poll"},
		{"setup", internal, http.MethodPost, "/setup"},
		{"comment", none, http.MethodPost, "/api/v1/alerts/abc/comments"},
		{"claim", none, http.MethodPost, "/api/v1/alerts/abc/claim"},
		{"silence", none, http.MethodPost, "/api/v1/silences"},
		{"silence template", none, http.MethodPost, "/api/v1/silence-templates"},
		{"settings", none, http.MethodPut, "/api/v1/settings"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for i := 0; i < n; i++ {
				// Same peer every time: the old per-IP limiters keyed on it.
				if code := serveFrom(tc.e, tc.method, tc.path, "{", "192.0.2.10:5000", ""); code == http.StatusTooManyRequests {
					t.Fatalf("request %d: 429, want no rate limit", i)
				}
			}
		})
	}
}
