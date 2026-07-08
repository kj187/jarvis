package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

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

func newTestServer(t *testing.T) (*Server, *history.AlertStore) {
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
	cfg := &config.Config{}

	return NewServer(alertStore, history.NewSilenceStore(), store, hub, registry, cfg, nil, auth.NoneProvider{}, userStore), alertStore
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

func TestGetAlerts_ResolvedFromDB(t *testing.T) {
	srv, _ := newTestServer(t)

	// Seed a resolved alert in the DB.
	if err := srv.store.UpsertFingerprint("aabbccddeeff0011", "DBAlert", "homelab", map[string]string{"alertname": "DBAlert"}); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	if _, _, err := srv.store.RecordStatusChange("aabbccddeeff0011", "homelab", "http://am:9093", "firing", time.Now(), nil); err != nil {
		t.Fatalf("RecordStatusChange: %v", err)
	}
	if err := srv.store.RecordResolved("aabbccddeeff0011", time.Now()); err != nil {
		t.Fatalf("RecordResolved: %v", err)
	}

	// Alert is NOT in the in-memory store — must come from DB.
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts?state=resolved", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.QueryParams().Set("state", "resolved")

	if err := srv.getAlerts(c); err != nil {
		t.Fatalf("getAlerts: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	if !contains(rec.Body.String(), "aabbccddeeff0011") {
		t.Errorf("expected fingerprint in response: %s", rec.Body.String())
	}
}

func TestGetAlerts_ResolvedFromDB_ExcludesRefired(t *testing.T) {
	srv, _ := newTestServer(t)

	if err := srv.store.UpsertFingerprint("aabbccddeeff0022", "RefiredAlert", "homelab", map[string]string{"alertname": "RefiredAlert"}); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	if _, _, err := srv.store.RecordStatusChange("aabbccddeeff0022", "homelab", "http://am:9093", "firing", time.Now(), nil); err != nil {
		t.Fatalf("RecordStatusChange: %v", err)
	}
	if err := srv.store.RecordResolved("aabbccddeeff0022", time.Now()); err != nil {
		t.Fatalf("RecordResolved: %v", err)
	}
	// Re-fire
	if _, _, err := srv.store.RecordStatusChange("aabbccddeeff0022", "homelab", "http://am:9093", "firing", time.Now(), nil); err != nil {
		t.Fatalf("RecordStatusChange re-fire: %v", err)
	}

	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts?state=resolved", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.QueryParams().Set("state", "resolved")

	if err := srv.getAlerts(c); err != nil {
		t.Fatalf("getAlerts: %v", err)
	}
	if contains(rec.Body.String(), "aabbccddeeff0022") {
		t.Errorf("re-fired alert should not appear in resolved: %s", rec.Body.String())
	}
}

func TestValidateFingerprint(t *testing.T) {
	valid := []string{
		"1234567890abcdef", // exactly 16 hex chars
		"abcdef1234567890",
		"ffffffffffffffff",
		"0000000000000000",
	}
	invalid := []string{
		"INVALID!",          // non-hex
		"abc123",            // too short
		"1234567890abcdef0", // too long (17 chars)
		"1234567890ABCDEF",  // uppercase rejected
		"",
	}
	for _, fp := range valid {
		if !validateFingerprint(fp) {
			t.Errorf("validateFingerprint(%q) = false, want true", fp)
		}
	}
	for _, fp := range invalid {
		if validateFingerprint(fp) {
			t.Errorf("validateFingerprint(%q) = true, want false", fp)
		}
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

func TestGetAlertTimeline_InvalidFingerprint(t *testing.T) {
	srv, _ := newTestServer(t)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts/INVALID!/timeline", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("INVALID!")

	err := srv.getAlertTimeline(c)
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
