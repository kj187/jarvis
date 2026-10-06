package api

import (
	"context"
	"embed"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sync/atomic"
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

var upstreamRouteParam = regexp.MustCompile(`:[A-Za-z]+`)

// validRouteParam gives a path parameter a value that passes the handlers'
// format validation (fingerprint: 16 hex, ids: UUID), so the request reaches
// the code that could call upstream instead of stopping at a 400.
func validRouteParam(name string) string {
	switch name {
	case ":fingerprint":
		return "0123456789abcdef"
	case ":id":
		return "123e4567-e89b-12d3-a456-426614174000"
	default:
		return "x"
	}
}

// Critical Invariant #13: client-facing read endpoints never call
// Alertmanager. They serve poll snapshots, so Alertmanager load does not grow
// with the number of open browser tabs. The test points two clusters at a
// counting mock Alertmanager, requests every registered GET route and expects
// zero upstream hits. Walking e.Routes() covers a read endpoint added later
// the moment it is registered.
func TestRouter_ReadEndpointsNeverCallAlertmanager(t *testing.T) {
	var hits atomic.Int64
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("[]"))
	}))
	t.Cleanup(am.Close)

	// The counter itself works: a direct request is seen.
	selfCheck, err := http.NewRequestWithContext(context.Background(), http.MethodGet, am.URL+"/api/v2/alerts", nil)
	if err != nil {
		t.Fatalf("self-check request: %v", err)
	}
	resp, err := http.DefaultClient.Do(selfCheck) // #nosec G704 -- loopback test server
	if err != nil {
		t.Fatalf("self-check request: %v", err)
	}
	_ = resp.Body.Close()
	if hits.Load() != 1 {
		t.Fatalf("mock Alertmanager did not count the self-check request (hits=%d)", hits.Load())
	}
	hits.Store(0)

	registry := cluster.NewRegistry([]config.ClusterConfig{
		{Name: "prod", AlertmanagerURL: am.URL},
		{Name: "staging", AlertmanagerURL: am.URL},
	})
	e := newRouterWithRegistry(t, registry)

	checked := 0
	for _, r := range e.Routes() {
		if r.Method != http.MethodGet {
			continue
		}
		path := upstreamRouteParam.ReplaceAllStringFunc(r.Path, validRouteParam)
		// The WebSocket route needs an upgrade handshake; it streams the same
		// snapshots and is covered by the hub tests.
		if path == "/ws" {
			continue
		}
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, path, nil)
		e.ServeHTTP(httptest.NewRecorder(), req)
		checked++
		if n := hits.Load(); n != 0 {
			t.Fatalf("GET %s called Alertmanager %d time(s); read endpoints must serve snapshots only (Invariant #13)", r.Path, n)
		}
	}
	if checked < 10 {
		t.Fatalf("only %d GET routes checked — the route walk is not seeing the router", checked)
	}
}

// newRouterWithRegistry builds the full router (auth mode none) around the
// given cluster registry.
func newRouterWithRegistry(t *testing.T, registry *cluster.Registry) *echo.Echo {
	t.Helper()
	database, dialect, err := idb.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := idb.Migrate(database, dialect); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	hub := ws.NewHub(nil, nil, metrics.New("test"))
	go hub.Run()
	return NewRouter(&history.AlertStore{}, history.NewSilenceStore(), history.NewStore(database, dialect), hub, registry, &config.Config{}, embed.FS{}, &fakeTriggerer{}, auth.NoneProvider{}, users.NewStore(database, dialect), settings.NewStore(database, dialect), globalsettings.NewStore(database, dialect), metrics.New("test"), fanout.NoopFanout{})
}
