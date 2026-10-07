package api

import (
	"context"
	"embed"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"strings"
	"sync/atomic"
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
// this harness (an admin session on internal auth, a seeded alert, no OIDC
// provider, no embedded frontend). Each is reviewed by hand; a new unreached
// route fails the test until it is listed, and a listed route that exists no
// more or that now answers fails it too (stale exception).
var unreachableReadRoutes = map[string]string{
	"/api/v1/admin/settings/:section": "no settings section is registered yet, every name is a 404",
	"/auth/oidc/start":                "no OIDC provider configured (internal auth)",
	"/auth/oidc/callback":             "no OIDC provider configured (internal auth)",
	"/*":                              "static frontend, nothing embedded in tests",
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
	e, session := newRouterWithRegistryAndTrigger(t, registry, trigger, am.URL)

	checked := 0
	registered := map[string]bool{}
	var unreached []string
	for _, r := range e.Routes() {
		if r.Method != http.MethodGet {
			continue
		}
		registered[r.Path] = true
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
			req.AddCookie(session)
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
	for route, why := range unreachableReadRoutes {
		if !registered[route] {
			t.Errorf("unreachableReadRoutes lists %s (%s), but no such GET route is registered — remove the stale exception", route, why)
		}
		if !slices.Contains(unreached, route) {
			t.Errorf("unreachableReadRoutes lists %s (%s), but it answers now — remove the stale exception", route, why)
		}
	}
	if checked < 10 {
		t.Fatalf("only %d GET routes reached their handler — the route walk is not seeing the router (unreached: %v)", checked, unreached)
	}
}

// newRouterWithRegistryAndTrigger builds the full router (internal auth,
// write_protect) around the given cluster registry and a caller-owned poll
// trigger, so a test can assert the router never fired it. It seeds one alert
// event (fingerprint 0123456789abcdef, cluster prod) and returns the session
// cookie of an admin user, so admin-only and per-alert read routes are
// reachable.
func newRouterWithRegistryAndTrigger(t *testing.T, registry *cluster.Registry, trigger *fakeTriggerer, amURL string) (*echo.Echo, *http.Cookie) {
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
	hash, err := auth.HashPassword("a-long-enough-password")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	admin, err := userStore.Create(context.Background(), &users.CreateUser{Username: "admin", Role: "admin", Provider: "internal", PasswordHash: hash})
	if err != nil {
		t.Fatalf("create admin: %v", err)
	}
	token, err := auth.CreateToken(testSecretKey, &auth.User{ID: admin.ID, Username: admin.Username, Role: admin.Role, Provider: admin.Provider, TokenVersion: admin.TokenVersion})
	if err != nil {
		t.Fatalf("create token: %v", err)
	}
	session := &http.Cookie{Name: auth.SessionCookieName, Value: token} // #nosec G124 -- request cookie, flags only matter on Set-Cookie

	historyStore := history.NewStore(database, dialect)
	if err := historyStore.UpsertFingerprint("0123456789abcdef", "TestAlert", "prod", map[string]string{"alertname": "TestAlert"}); err != nil {
		t.Fatalf("seed fingerprint: %v", err)
	}
	if _, _, err := historyStore.RecordStatusChange("0123456789abcdef", "prod", amURL, "firing", time.Now(), nil); err != nil {
		t.Fatalf("seed alert event: %v", err)
	}

	hub := ws.NewHub(nil, nil, metrics.New("test"))
	go hub.Run()
	cfg := &config.Config{AuthProvider: "internal", AuthMode: "write_protect", SecretKey: testSecretKey}
	return NewRouter(&history.AlertStore{}, history.NewSilenceStore(), historyStore, hub, registry, cfg, embed.FS{}, trigger, auth.NewInternalProvider(userStore), userStore, settings.NewStore(database, dialect), globalsettings.NewStore(database, dialect), metrics.New("test"), fanout.NoopFanout{}), session
}
