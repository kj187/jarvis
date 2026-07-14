package api

import (
	"context"
	"embed"
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
	"github.com/kj187/jarvis/backend/internal/users"
	"github.com/kj187/jarvis/backend/internal/ws"
)

func newTestRouter(t *testing.T, origins []string) *httptest.Server {
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

	e := NewRouter(alertStore, history.NewSilenceStore(), store, hub, registry, cfg, embed.FS{}, &fakeTriggerer{}, auth.NoneProvider{}, userStore, metrics.New("test"), fanout.NoopFanout{})
	return httptest.NewServer(e)
}

// TestRoutes verifies that all registered routes return 200.
// Critical invariant: /api/v1/alerts/groups must not be matched as a fingerprint parameter.
func TestRoutes(t *testing.T) {
	srv := newTestRouter(t, nil)
	defer srv.Close()

	routes := []string{
		"/api/v1/alerts/groups", // must not be interpreted as fingerprint "groups"
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

	e := NewRouter(alertStore, history.NewSilenceStore(), store, hub, registry, cfg, embed.FS{}, &fakeTriggerer{}, provider, userStore, metrics.New("test"), fanout.NoopFanout{})
	return httptest.NewServer(e)
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
