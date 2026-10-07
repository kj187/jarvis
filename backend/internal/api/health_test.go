package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	"github.com/labstack/echo/v4"
)

func getHealthPath(t *testing.T, srv *Server, path string, h echo.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	if err := h(e.NewContext(req, rec)); err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	return rec
}

func TestHealthLive_AlwaysOK_EvenWithoutDatabase(t *testing.T) {
	srv, _, db := newTestServerAndDB(t)
	_ = db.Close()

	rec := getHealthPath(t, srv, "/health/live", srv.getHealthLive)
	if rec.Code != http.StatusOK {
		t.Fatalf("live = %d, want 200 (liveness must not depend on the DB)", rec.Code)
	}
}

func TestHealthReady_OKWithDatabase(t *testing.T) {
	srv, _ := newTestServer(t)

	rec := getHealthPath(t, srv, "/health/ready", srv.getHealthReady)
	if rec.Code != http.StatusOK {
		t.Fatalf("ready = %d, want 200: %s", rec.Code, rec.Body.String())
	}
}

func TestHealthReady_503WhenDatabaseUnreachable(t *testing.T) {
	srv, _, db := newTestServerAndDB(t)
	_ = db.Close()

	rec := getHealthPath(t, srv, "/health/ready", srv.getHealthReady)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("ready = %d, want 503", rec.Code)
	}
	if body := rec.Body.String(); len(body) > 0 && (contains(body, "sql") || contains(body, "closed")) {
		t.Errorf("response leaks internals: %s", body)
	}
}

func TestHealthReady_AlertmanagerOutageDoesNotMakeItRed(t *testing.T) {
	registry := cluster.NewRegistry([]config.ClusterConfig{
		{Name: "down", AlertmanagerURL: "http://127.0.0.1:0", AlertmanagerLinkURL: "http://127.0.0.1:0"},
	})
	srv := newTestServerWithRegistry(t, registry)
	srv.pollTrigger = &freshnessTriggerer{fresh: nil, upStates: map[string]map[string]bool{"down": {"127.0.0.1:0": false}}}

	rec := getHealthPath(t, srv, "/health/ready", srv.getHealthReady)
	if rec.Code != http.StatusOK {
		t.Fatalf("ready = %d, want 200 even though every Alertmanager is down", rec.Code)
	}
}

func TestHealth_LegacyEndpointUnchanged(t *testing.T) {
	srv, _, db := newTestServerAndDB(t)
	_ = db.Close()

	rec := getHealthPath(t, srv, "/health", srv.getHealth)
	if rec.Code != http.StatusOK || rec.Body.String() != "{\"status\":\"ok\"}\n" {
		t.Fatalf("/health = %d %q, want the unchanged 200 {\"status\":\"ok\"}", rec.Code, rec.Body.String())
	}
}

func TestGetStatus_DegradedWhenDatabaseUnreachable(t *testing.T) {
	srv, _, db := newTestServerAndDB(t)
	srv.pollTrigger = &fakeTriggerer{}

	rec := getHealthPath(t, srv, "/api/v1/status", srv.getStatus)
	var ok map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &ok)
	if ok["status"] != "ok" || ok["database"] != "ok" {
		t.Fatalf("healthy: status=%v database=%v, want ok/ok", ok["status"], ok["database"])
	}

	_ = db.Close()
	srv.dbHealth.reset()
	rec = getHealthPath(t, srv, "/api/v1/status", srv.getStatus)
	var bad map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &bad)
	if rec.Code != http.StatusOK || bad["status"] != "degraded" || bad["database"] != "unavailable" {
		t.Fatalf("db down: code=%d status=%v database=%v, want 200 degraded/unavailable", rec.Code, bad["status"], bad["database"])
	}
}

func TestGetClusters_FollowerUsesSnapshotUpStates(t *testing.T) {
	registry := cluster.NewRegistry([]config.ClusterConfig{
		{Name: "dead", AlertmanagerURL: "http://127.0.0.1:0", AlertmanagerLinkURL: "http://127.0.0.1:0"},
		{Name: "alive", AlertmanagerURL: "http://127.0.0.1:0", AlertmanagerLinkURL: "http://127.0.0.1:0"},
	})
	srv := newTestServerWithRegistry(t, registry)
	// A follower never polls, so the registry holds no up-state; the
	// recorder-provided (snapshot-derived) states must win over that optimism.
	srv.pollTrigger = &freshnessTriggerer{upStates: map[string]map[string]bool{
		"dead":  {"127.0.0.1:0": false},
		"alive": {"127.0.0.1:0": true},
	}}

	got := map[string]bool{}
	for _, c := range getClustersResponse(t, srv) {
		got[c.Name] = c.Healthy
	}
	if got["dead"] || !got["alive"] {
		t.Errorf("healthy = %v, want dead=false alive=true", got)
	}
}

// A client that hangs up mid-probe must not poison the cached result: the ping
// runs detached from the request context, so the next probe still sees "ok".
func TestDBHealth_CancelledRequestDoesNotCacheFailure(t *testing.T) {
	var h dbHealth
	ping := func(ctx context.Context) error { return ctx.Err() }

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if !h.check(ctx, ping) {
		t.Fatal("check = false for a cancelled request context, want true (ping must not inherit the cancellation)")
	}
	if !h.check(context.Background(), ping) {
		t.Fatal("cached result = false, want true")
	}
}
