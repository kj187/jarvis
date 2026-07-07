package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/metrics"
	"github.com/kj187/jarvis/backend/internal/models"
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
	hub := ws.NewHub(nil, nil, metrics.New("test"))
	go hub.Run()

	return NewServer(alertStore, history.NewSilenceStore(), store, hub, registry, &config.Config{}, nil, auth.NoneProvider{}, userStore)
}

func TestGetClusters_SingleMember_MembersFieldOmitted(t *testing.T) {
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
	}))
	defer am.Close()

	registry := cluster.NewRegistry([]config.ClusterConfig{
		{Name: "homelab", AlertmanagerURL: am.URL, AlertmanagerLinkURL: am.URL},
	})
	srv := newTestServerWithRegistry(t, registry)

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
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	if got[0].Members != nil {
		t.Errorf("Members = %+v, want nil for single-member cluster (byte-identical payload guarantee)", got[0].Members)
	}
	if !got[0].Healthy {
		t.Error("Healthy = false, want true")
	}
}

func TestGetClusters_MultiMember_DegradedButHealthy(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
	}))
	defer up.Close()
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer down.Close()

	registry := cluster.NewRegistry([]config.ClusterConfig{
		{
			Name: "prod",
			Members: []config.MemberConfig{
				{Name: config.DeriveMemberName(up.URL), URL: up.URL, LinkURL: up.URL},
				{Name: config.DeriveMemberName(down.URL), URL: down.URL, LinkURL: down.URL},
			},
		},
	})
	srv := newTestServerWithRegistry(t, registry)

	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/clusters", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := srv.getClusters(c); err != nil {
		t.Fatalf("getClusters: %v", err)
	}
	var got []models.ClusterInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
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
}

func TestGetClusters_AllMembersDown_Unhealthy(t *testing.T) {
	down1 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer down1.Close()
	down2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer down2.Close()

	registry := cluster.NewRegistry([]config.ClusterConfig{
		{
			Name: "prod",
			Members: []config.MemberConfig{
				{Name: config.DeriveMemberName(down1.URL), URL: down1.URL, LinkURL: down1.URL},
				{Name: config.DeriveMemberName(down2.URL), URL: down2.URL, LinkURL: down2.URL},
			},
		},
	})
	srv := newTestServerWithRegistry(t, registry)

	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/clusters", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := srv.getClusters(c); err != nil {
		t.Fatalf("getClusters: %v", err)
	}
	var got []models.ClusterInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got[0].Healthy {
		t.Error("Healthy = true, want false (all members down)")
	}
}
