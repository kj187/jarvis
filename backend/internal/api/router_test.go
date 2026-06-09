package api

import (
	"context"
	"embed"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/ws"
)

func newTestRouter(t *testing.T, origins []string) *httptest.Server {
	t.Helper()
	db, err := idb.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := idb.Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	alertStore := &history.AlertStore{}
	store := history.NewStore(db)
	hub := ws.NewHub(nil, nil)
	go hub.Run()
	registry := cluster.NewRegistry(nil)
	cfg := &config.Config{AllowedOrigins: origins}

	e := NewRouter(alertStore, store, hub, registry, cfg, embed.FS{}, nil)
	return httptest.NewServer(e)
}

// TestRouteOrder_GroupsBeforeFingerprint verifies the critical invariant:
// /api/v1/alerts/groups must not be matched as a fingerprint parameter.
func TestRouteOrder_GroupsBeforeFingerprint(t *testing.T) {
	srv := newTestRouter(t, nil)
	defer srv.Close()

	// /api/v1/alerts/groups must return 200, not treat "groups" as a fingerprint
	var client http.Client
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+"/api/v1/alerts/groups", nil)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET /alerts/groups: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("/alerts/groups status = %d, want 200 (got matched as fingerprint?)", resp.StatusCode)
	}
}

func TestRoute_AlertsList(t *testing.T) {
	srv := newTestRouter(t, nil)
	defer srv.Close()

	var client http.Client
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+"/api/v1/alerts", nil)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET /alerts: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("/alerts status = %d, want 200", resp.StatusCode)
	}
}

func TestRoute_Health(t *testing.T) {
	srv := newTestRouter(t, nil)
	defer srv.Close()

	var client http.Client
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+"/health", nil)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET /health: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("/health status = %d, want 200", resp.StatusCode)
	}
}

func TestRoute_Status(t *testing.T) {
	srv := newTestRouter(t, nil)
	defer srv.Close()

	var client http.Client
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+"/api/v1/status", nil)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET /status: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("/api/v1/status status = %d, want 200", resp.StatusCode)
	}
}

func TestRoute_Silences(t *testing.T) {
	srv := newTestRouter(t, nil)
	defer srv.Close()

	var client http.Client
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+"/api/v1/silences", nil)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET /silences: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("/api/v1/silences status = %d, want 200", resp.StatusCode)
	}
}

func TestRoute_Clusters(t *testing.T) {
	srv := newTestRouter(t, nil)
	defer srv.Close()

	var client http.Client
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+"/api/v1/clusters", nil)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET /clusters: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("/api/v1/clusters status = %d, want 200", resp.StatusCode)
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
	defer resp.Body.Close()

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
	defer resp.Body.Close()

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
	defer resp.Body.Close()
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
	defer resp.Body.Close()
	_ = srv // suppress unused warning
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("status = %d, want 204", resp.StatusCode)
	}
}
