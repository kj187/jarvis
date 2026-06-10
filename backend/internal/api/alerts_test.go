package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/models"
	"github.com/kj187/jarvis/backend/internal/ws"
)

func newTestServer(t *testing.T) (*Server, *history.AlertStore) {
	t.Helper()
	db, err := idb.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := idb.Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	alertStore := &history.AlertStore{}
	store := history.NewStore(db)
	hub := ws.NewHub(nil, nil)
	go hub.Run()
	registry := cluster.NewRegistry(nil)
	cfg := &config.Config{}

	return NewServer(alertStore, store, hub, registry, cfg, nil), alertStore
}

func TestGetAlerts_Empty(t *testing.T) {
	srv, _ := newTestServer(t)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := srv.getAlerts(c); err != nil {
		t.Fatalf("getAlerts: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
}

func TestGetAlerts_WithAlerts(t *testing.T) {
	srv, alertStore := newTestServer(t)
	alertStore.Set([]models.EnrichedAlert{
		{Fingerprint: "abc123", Labels: map[string]string{"alertname": "Test", "severity": "critical"}, Status: models.AlertStatus{State: "active"}, ClusterName: "homelab"},
	})

	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := srv.getAlerts(c); err != nil {
		t.Fatalf("getAlerts: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d", rec.Code)
	}
	if !contains(rec.Body.String(), "abc123") {
		t.Errorf("expected abc123 in response: %s", rec.Body.String())
	}
}

func TestGetAlertHistory_InvalidFingerprint(t *testing.T) {
	srv, _ := newTestServer(t)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts/INVALID!/history", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("INVALID!")

	err := srv.getAlertHistory(c)
	if err == nil {
		t.Error("expected error for invalid fingerprint, got nil")
	}
}

func TestGetHealth(t *testing.T) {
	srv, _ := newTestServer(t)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := srv.getHealth(c); err != nil {
		t.Fatalf("getHealth: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d", rec.Code)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsStr(s, substr))
}

func containsStr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
