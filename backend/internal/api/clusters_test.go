package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/labstack/echo/v4"

	amclient "github.com/kj187/jarvis/backend/internal/alertmanager"
	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/fanout"
	"github.com/kj187/jarvis/backend/internal/globalsettings"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/metrics"
	"github.com/kj187/jarvis/backend/internal/models"
	"github.com/kj187/jarvis/backend/internal/settings"
	"github.com/kj187/jarvis/backend/internal/users"
	"github.com/kj187/jarvis/backend/internal/ws"
)

func newTestServerWithRegistry(t *testing.T, registry *cluster.Registry) *Server {
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
	settingsStore := settings.NewStore(database, dialect)
	globalSettingsStore := globalsettings.NewStore(database, dialect)
	hub := ws.NewHub(nil, nil, metrics.New("test"))
	go hub.Run()

	return NewServer(alertStore, history.NewSilenceStore(), store, hub, registry, &config.Config{}, nil, auth.NoneProvider{}, userStore, settingsStore, globalSettingsStore, fanout.NoopFanout{})
}

// healthMockAM serves an empty alert list (so FetchAlerts marks the member up)
// and counts /api/v2/status hits — getClusters must never live-ping.
func healthMockAM(t *testing.T, statusHits *atomic.Int64) *httptest.Server {
	t.Helper()
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v2/status" {
			statusHits.Add(1)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]amclient.GettableAlert{})
	}))
	t.Cleanup(am.Close)
	return am
}

func downMockAM(t *testing.T) *httptest.Server {
	t.Helper()
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	t.Cleanup(am.Close)
	return am
}

func getClustersResponse(t *testing.T, srv *Server) []models.ClusterInfo {
	t.Helper()
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/clusters", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := srv.getClusters(c); err != nil {
		t.Fatalf("getClusters: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var got []models.ClusterInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return got
}

func TestGetClusters_SingleMember_MembersFieldOmitted(t *testing.T) {
	var statusHits atomic.Int64
	am := healthMockAM(t, &statusHits)

	registry := cluster.NewRegistry([]config.ClusterConfig{
		{Name: "homelab", AlertmanagerURL: am.URL, AlertmanagerLinkURL: am.URL},
	})
	// One poll cycle populates the cached member up-state.
	if _, err := registry.Get("homelab").FetchAlerts(context.Background(), nil); err != nil {
		t.Fatalf("FetchAlerts: %v", err)
	}
	srv := newTestServerWithRegistry(t, registry)

	got := getClustersResponse(t, srv)
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	if got[0].Members != nil {
		t.Errorf("Members = %+v, want nil for single-member cluster (byte-identical payload guarantee)", got[0].Members)
	}
	if !got[0].Healthy {
		t.Error("Healthy = false, want true")
	}
	if statusHits.Load() != 0 {
		t.Errorf("getClusters live-pinged AM %d times, want 0 (health comes from poll state)", statusHits.Load())
	}
}

func TestGetClusters_MultiMember_DegradedButHealthy(t *testing.T) {
	var statusHits atomic.Int64
	up := healthMockAM(t, &statusHits)
	down := downMockAM(t)

	registry := cluster.NewRegistry([]config.ClusterConfig{
		{
			Name: "prod",
			Members: []config.MemberConfig{
				{Name: config.DeriveMemberName(up.URL), URL: up.URL, LinkURL: up.URL},
				{Name: config.DeriveMemberName(down.URL), URL: down.URL, LinkURL: down.URL},
			},
		},
	})
	if _, err := registry.Get("prod").FetchAlerts(context.Background(), nil); err != nil {
		t.Fatalf("FetchAlerts: %v", err)
	}
	srv := newTestServerWithRegistry(t, registry)

	got := getClustersResponse(t, srv)
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	if !got[0].Healthy {
		t.Error("Healthy = false, want true (cluster is healthy when >=1 member is up)")
	}
	if len(got[0].Members) != 2 {
		t.Fatalf("len(Members) = %d, want 2", len(got[0].Members))
	}
	healthyCount := 0
	for _, m := range got[0].Members {
		if m.Healthy {
			healthyCount++
		}
	}
	if healthyCount != 1 {
		t.Errorf("healthy members = %d, want 1 (degraded: 1/2 up)", healthyCount)
	}
	if statusHits.Load() != 0 {
		t.Errorf("getClusters live-pinged AM %d times, want 0", statusHits.Load())
	}
}

func TestGetClusters_AllMembersDown_Unhealthy(t *testing.T) {
	down1 := downMockAM(t)
	down2 := downMockAM(t)

	registry := cluster.NewRegistry([]config.ClusterConfig{
		{
			Name: "prod",
			Members: []config.MemberConfig{
				{Name: config.DeriveMemberName(down1.URL), URL: down1.URL, LinkURL: down1.URL},
				{Name: config.DeriveMemberName(down2.URL), URL: down2.URL, LinkURL: down2.URL},
			},
		},
	})
	// FetchAlerts fails (all members down) but still records the up-state.
	if _, err := registry.Get("prod").FetchAlerts(context.Background(), nil); err == nil {
		t.Fatal("FetchAlerts should fail when all members are down")
	}
	srv := newTestServerWithRegistry(t, registry)

	got := getClustersResponse(t, srv)
	if got[0].Healthy {
		t.Error("Healthy = true, want false (all members down)")
	}
}

func TestGetStatus_IncludesPollIntervalSeconds(t *testing.T) {
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

	srv := NewServer(
		&history.AlertStore{},
		history.NewSilenceStore(),
		history.NewStore(database, dialect),
		hub,
		cluster.NewRegistry(nil),
		&config.Config{PollInterval: 45 * time.Second},
		&fakeTriggerer{},
		auth.NoneProvider{},
		users.NewStore(database, dialect),
		settings.NewStore(database, dialect),
		globalsettings.NewStore(database, dialect),
		fanout.NoopFanout{},
	)

	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/status", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := srv.getStatus(c); err != nil {
		t.Fatalf("getStatus: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}

	var got map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got["poll_interval_seconds"] != float64(45) {
		t.Errorf("poll_interval_seconds = %v, want 45", got["poll_interval_seconds"])
	}
	// A zero-value AlertStore reports the default resolved-buffer window (20m).
	if got["resolved_buffer_ttl_seconds"] != float64(1200) {
		t.Errorf("resolved_buffer_ttl_seconds = %v, want 1200", got["resolved_buffer_ttl_seconds"])
	}
}

func TestGetStatus_ReportsConfiguredResolvedBufferTTL(t *testing.T) {
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
	srv := NewServer(
		history.NewAlertStore(90*time.Minute),
		history.NewSilenceStore(),
		history.NewStore(database, dialect),
		hub,
		cluster.NewRegistry(nil),
		&config.Config{},
		&fakeTriggerer{},
		auth.NoneProvider{},
		users.NewStore(database, dialect),
		settings.NewStore(database, dialect),
		globalsettings.NewStore(database, dialect),
		fanout.NoopFanout{},
	)
	e := echo.New()
	rec := httptest.NewRecorder()
	c := e.NewContext(httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/status", nil), rec)
	if err := srv.getStatus(c); err != nil {
		t.Fatalf("getStatus: %v", err)
	}
	var got map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got["resolved_buffer_ttl_seconds"] != float64(5400) {
		t.Errorf("resolved_buffer_ttl_seconds = %v, want 5400", got["resolved_buffer_ttl_seconds"])
	}
}

func TestGetClusters_NoPollYet_OptimisticallyHealthy(t *testing.T) {
	// No FetchAlerts ran — member state unknown. Same optimism as
	// cluster.writeOrder: report healthy until the first poll says otherwise.
	registry := cluster.NewRegistry([]config.ClusterConfig{
		{Name: "fresh", AlertmanagerURL: "http://127.0.0.1:0", AlertmanagerLinkURL: "http://127.0.0.1:0"},
	})
	srv := newTestServerWithRegistry(t, registry)

	got := getClustersResponse(t, srv)
	if len(got) != 1 || !got[0].Healthy {
		t.Errorf("fresh cluster should be optimistically healthy, got %+v", got)
	}
}

type freshnessTriggerer struct {
	fakeTriggerer
	fresh    map[string]history.ClusterFreshness
	upStates map[string]map[string]bool
}

func (f *freshnessTriggerer) ClusterUpStates() map[string]map[string]bool {
	return f.upStates
}

func (f *freshnessTriggerer) ClusterFreshness() map[string]history.ClusterFreshness {
	return f.fresh
}

func TestGetClusters_ReportsDataAge(t *testing.T) {
	registry := cluster.NewRegistry([]config.ClusterConfig{
		{Name: "old", AlertmanagerURL: "http://127.0.0.1:0", AlertmanagerLinkURL: "http://127.0.0.1:0"},
		{Name: "live", AlertmanagerURL: "http://127.0.0.1:0", AlertmanagerLinkURL: "http://127.0.0.1:0"},
		{Name: "unknown", AlertmanagerURL: "http://127.0.0.1:0", AlertmanagerLinkURL: "http://127.0.0.1:0"},
	})
	srv := newTestServerWithRegistry(t, registry)
	oldAt := time.Date(2026, 10, 2, 8, 0, 0, 0, time.UTC)
	liveAt := oldAt.Add(time.Hour)
	srv.pollTrigger = &freshnessTriggerer{fresh: map[string]history.ClusterFreshness{
		"old":  {LastSuccessAt: oldAt, Stale: true},
		"live": {LastSuccessAt: liveAt},
	}}

	got := map[string]models.ClusterInfo{}
	for _, c := range getClustersResponse(t, srv) {
		got[c.Name] = c
	}
	if c := got["old"]; !c.Stale || c.LastSuccessfulPollAt == nil || !c.LastSuccessfulPollAt.Equal(oldAt) {
		t.Errorf("old = %+v, want stale with lastSuccessfulPollAt=%v", c, oldAt)
	}
	if c := got["live"]; c.Stale || c.LastSuccessfulPollAt == nil || !c.LastSuccessfulPollAt.Equal(liveAt) {
		t.Errorf("live = %+v, want fresh with lastSuccessfulPollAt=%v", c, liveAt)
	}
	if c := got["unknown"]; c.Stale || c.LastSuccessfulPollAt != nil {
		t.Errorf("unknown = %+v, want fresh and no timestamp (no freshness data)", c)
	}
}

func TestGetClusters_NoFreshnessSource_FieldsOmitted(t *testing.T) {
	registry := cluster.NewRegistry([]config.ClusterConfig{
		{Name: "a", AlertmanagerURL: "http://127.0.0.1:0", AlertmanagerLinkURL: "http://127.0.0.1:0"},
	})
	srv := newTestServerWithRegistry(t, registry) // pollTrigger is nil
	got := getClustersResponse(t, srv)
	if len(got) != 1 || got[0].Stale || got[0].LastSuccessfulPollAt != nil {
		t.Errorf("got %+v, want fresh cluster without timestamp", got)
	}
}

func TestGetClusters_NeverExposesURLCredentials(t *testing.T) {
	registry := cluster.NewRegistry([]config.ClusterConfig{
		{
			Name:                "prod",
			AlertmanagerURL:     "http://user:s3cretpw@am1:9093",
			AlertmanagerLinkURL: "http://user:s3cretpw@am1:9093",
			PrometheusURL:       "http://pu:ppw@prom:9090",
			Members: []config.MemberConfig{
				{Name: "am1:9093", URL: "http://user:s3cretpw@am1:9093", LinkURL: "http://user:s3cretpw@am1:9093"},
				{Name: "am2:9093", URL: "http://user:s3cretpw@am2:9093", LinkURL: "http://user:s3cretpw@am2:9093"},
			},
		},
	})
	srv := newTestServerWithRegistry(t, registry)

	rec := httptest.NewRecorder()
	c := echo.New().NewContext(httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/clusters", nil), rec)
	if err := srv.getClusters(c); err != nil {
		t.Fatalf("getClusters: %v", err)
	}
	body := rec.Body.String()
	for _, secret := range []string{"user:", "s3cretpw", "pu:", "ppw", "@"} {
		if strings.Contains(body, secret) {
			t.Errorf("/clusters body contains %q: %s", secret, body)
		}
	}
	if !strings.Contains(body, "http://am1:9093") || !strings.Contains(body, "http://prom:9090") {
		t.Errorf("/clusters lost the credential-free URLs: %s", body)
	}
}
