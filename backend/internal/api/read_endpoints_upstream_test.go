package api

import (
	"context"
	"embed"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
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

// validRouteQuery adds the query parameters a route requires to get past its
// input validation, plus the caller's extra query.
func validRouteQuery(route, extra string) string {
	var parts []string
	switch {
	case strings.HasSuffix(route, "/heatmap"):
		parts = append(parts, "range=24h")
	case strings.HasSuffix(route, "/comments"):
		parts = append(parts, "cluster=prod")
	}
	if extra != "" && (len(parts) == 0 || parts[0] != extra) {
		parts = append(parts, extra)
	}
	if len(parts) == 0 {
		return ""
	}
	return "?" + strings.Join(parts, "&")
}

// unreachableReadRoutes are GET routes that cannot reach their handler in
// this harness (auth mode none, no OIDC provider, no embedded frontend) or
// that judge an unknown fingerprint before touching any data. Each is
// reviewed by hand; a new unreached route fails the test until it is listed.
var unreachableReadRoutes = map[string]string{
	"/api/v1/alerts/:fingerprint/stats": "fingerprint is not in the empty snapshot (404)",
	"/api/v1/admin/users":               "admin only, auth mode none has no admin session",
	"/api/v1/admin/settings":            "admin only, auth mode none has no admin session",
	"/api/v1/admin/settings/:section":   "admin only, auth mode none has no admin session",
	"/auth/me":                          "no session in auth mode none",
	"/auth/oidc/start":                  "no OIDC provider configured",
	"/auth/oidc/callback":               "no OIDC provider configured",
	"/*":                                "static frontend, nothing embedded in tests",
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
	trigger := &fakeTriggerer{}
	e := newRouterWithRegistryAndTrigger(t, registry, trigger)

	checked := 0
	var unreached []string
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
		// Once plain and once with a cluster filter: a handler that goes
		// upstream only when a cluster is named must not hide behind the
		// unfiltered request.
		reached := false
		for _, target := range []string{path + validRouteQuery(r.Path, ""), path + validRouteQuery(r.Path, "cluster=prod")} {
			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, target, nil)
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)
			if n := hits.Load(); n != 0 {
				t.Fatalf("GET %s called Alertmanager %d time(s); read endpoints must serve snapshots only (Invariant #13)", target, n)
			}
			if n := trigger.calls; n != 0 {
				t.Fatalf("GET %s triggered a poll %d time(s); read endpoints must not drive the recorder (Invariant #13)", target, n)
			}
			// A 400/404 means the request was rejected before the handler
			// did its work, so it proves nothing about upstream calls.
			if rec.Code == http.StatusOK || rec.Code == http.StatusNoContent {
				reached = true
			}
		}
		if reached {
			checked++
		} else {
			unreached = append(unreached, r.Path)
		}
	}
	for _, route := range unreached {
		if _, known := unreachableReadRoutes[route]; !known {
			t.Errorf("GET %s never reached its handler (400/404/401/403 on every request) — fix the request or list it in unreachableReadRoutes with a reason", route)
		}
	}
	if checked < 10 {
		t.Fatalf("only %d GET routes reached their handler — the route walk is not seeing the router (unreached: %v)", checked, unreached)
	}
}

// newRouterWithRegistryAndTrigger builds the full router (auth mode none)
// around the given cluster registry and a caller-owned poll trigger, so a test
// can assert the router never fired it.
func newRouterWithRegistryAndTrigger(t *testing.T, registry *cluster.Registry, trigger *fakeTriggerer) *echo.Echo {
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
	return NewRouter(&history.AlertStore{}, history.NewSilenceStore(), history.NewStore(database, dialect), hub, registry, &config.Config{}, embed.FS{}, trigger, auth.NoneProvider{}, users.NewStore(database, dialect), settings.NewStore(database, dialect), globalsettings.NewStore(database, dialect), metrics.New("test"), fanout.NoopFanout{})
}
