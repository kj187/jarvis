package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/ws"
	"github.com/labstack/echo/v4"
)

// newTestServerFull returns the server, alert store, and history store for tests
// that need to seed fingerprints (FK constraint for claims/comments).
func newTestServerFull(t *testing.T) (*Server, *history.AlertStore, *history.Store) {
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
	hub := ws.NewHub(nil, nil)
	go hub.Run()
	registry := cluster.NewRegistry(nil)
	cfg := &config.Config{}

	return NewServer(alertStore, store, hub, registry, cfg, nil), alertStore, store
}

// seedFP inserts a fingerprint row so FK constraints in claims/comments pass.
func seedFP(t *testing.T, store *history.Store, fp string) {
	t.Helper()
	if err := store.UpsertFingerprint(fp, "TestAlert", "homelab", map[string]string{"alertname": "TestAlert"}); err != nil {
		t.Fatalf("seedFP %q: %v", fp, err)
	}
}

// seedClaimHTTP fires a POST setClaim request so subsequent tests can get/check/release it.
func seedClaimHTTP(t *testing.T, srv *Server, e *echo.Echo, fp string, claimedBy string) {
	t.Helper()
	body := map[string]interface{}{"claimedBy": claimedBy}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues(fp)
	if err := srv.setClaim(c); err != nil {
		t.Fatalf("setClaim: %v", err)
	}
}

func TestGetClaim_InvalidFingerprint(t *testing.T) {
	srv, _, _ := newTestServerFull(t)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("INVALID!")

	err := srv.getClaim(c)
	if err == nil {
		t.Fatal("expected error for invalid fingerprint")
	}
}

func TestGetClaim_NotFound(t *testing.T) {
	srv, _, store := newTestServerFull(t)
	seedFP(t, store, "abc123")
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("abc123")

	err := srv.getClaim(c)
	if err == nil {
		t.Fatal("expected error for no active claim")
	}
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %v", err)
	}
}

func TestSetClaim_HappyPath(t *testing.T) {
	srv, _, store := newTestServerFull(t)
	seedFP(t, store, "abc123")
	e := echo.New()

	body := map[string]interface{}{"claimedBy": "alice", "note": "investigating"}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("abc123")

	if err := srv.setClaim(c); err != nil {
		t.Fatalf("setClaim: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want 201", rec.Code)
	}
	if !contains(rec.Body.String(), "alice") {
		t.Errorf("expected claimedBy in response: %s", rec.Body.String())
	}
}

func TestSetClaim_InvalidFingerprint(t *testing.T) {
	srv, _, _ := newTestServerFull(t)
	e := echo.New()
	body := map[string]interface{}{"claimedBy": "alice"}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("INVALID!")

	err := srv.setClaim(c)
	if err == nil {
		t.Fatal("expected error for invalid fingerprint")
	}
}

func TestSetClaim_MissingClaimedBy(t *testing.T) { //nolint:dupl
	srv, _, store := newTestServerFull(t)
	seedFP(t, store, "abc123")
	e := echo.New()
	body := map[string]interface{}{"note": "no user"}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("abc123")

	err := srv.setClaim(c)
	if err == nil {
		t.Fatal("expected error for missing claimedBy")
	}
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %v", err)
	}
}

func TestGetClaim_AfterSet(t *testing.T) { //nolint:dupl
	srv, _, store := newTestServerFull(t)
	seedFP(t, store, "deadbeef")
	e := echo.New()
	seedClaimHTTP(t, srv, e, "deadbeef", "bob")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("deadbeef")
	if err := srv.getClaim(c); err != nil {
		t.Fatalf("getClaim: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	if !contains(rec.Body.String(), "bob") {
		t.Errorf("expected bob in response: %s", rec.Body.String())
	}
}

func TestReleaseClaim_HappyPath(t *testing.T) {
	srv, _, store := newTestServerFull(t)
	seedFP(t, store, "deadbeef")
	e := echo.New()
	seedClaimHTTP(t, srv, e, "deadbeef", "carol")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodDelete, "/?by=carol", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("deadbeef")
	if err := srv.releaseClaim(c); err != nil {
		t.Fatalf("releaseClaim: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Errorf("status = %d, want 204", rec.Code)
	}
}

func TestReleaseClaim_NoClaim(t *testing.T) {
	srv, _, _ := newTestServerFull(t)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodDelete, "/?by=nobody", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("abc123")

	err := srv.releaseClaim(c)
	if err == nil {
		t.Fatal("expected error for no active claim")
	}
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %v", err)
	}
}

func TestReleaseClaim_InvalidFingerprint(t *testing.T) {
	srv, _, _ := newTestServerFull(t)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodDelete, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("INVALID!")

	err := srv.releaseClaim(c)
	if err == nil {
		t.Fatal("expected error for invalid fingerprint")
	}
}

func TestGetClaimHistory_Empty(t *testing.T) { //nolint:dupl
	srv, _, _ := newTestServerFull(t)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("abc123")

	if err := srv.getClaimHistory(c); err != nil {
		t.Fatalf("getClaimHistory: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	if rec.Body.String() != "[]\n" {
		t.Errorf("expected empty array, got %s", rec.Body.String())
	}
}

func TestGetClaimHistory_WithClaims(t *testing.T) { //nolint:dupl
	srv, _, store := newTestServerFull(t)
	seedFP(t, store, "abc123")
	e := echo.New()
	seedClaimHTTP(t, srv, e, "abc123", "dave")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("abc123")
	if err := srv.getClaimHistory(c); err != nil {
		t.Fatalf("getClaimHistory: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	if !contains(rec.Body.String(), "dave") {
		t.Errorf("expected dave in history: %s", rec.Body.String())
	}
}

func TestGetClaimHistory_InvalidFingerprint(t *testing.T) {
	srv, _, _ := newTestServerFull(t)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("INVALID!")

	err := srv.getClaimHistory(c)
	if err == nil {
		t.Fatal("expected error for invalid fingerprint")
	}
}
