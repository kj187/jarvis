package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/fanout"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/metrics"
	"github.com/kj187/jarvis/backend/internal/models"
	"github.com/kj187/jarvis/backend/internal/users"
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
	userStore := users.NewStore(database, dialect)
	hub := ws.NewHub(nil, nil, metrics.New("test"))
	go hub.Run()
	registry := cluster.NewRegistry(nil)
	cfg := &config.Config{}

	return NewServer(alertStore, history.NewSilenceStore(), store, hub, registry, cfg, nil, auth.NoneProvider{}, userStore, fanout.NoopFanout{}), alertStore, store
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

func TestGetClaim_NoActiveClaimReturnsNull(t *testing.T) {
	srv, _, store := newTestServerFull(t)
	seedFP(t, store, "1234567890abcdef")
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("1234567890abcdef")

	if err := srv.getClaim(c); err != nil {
		t.Fatalf("getClaim: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	if rec.Body.String() != "null\n" {
		t.Errorf("expected null response, got %s", rec.Body.String())
	}
}

func TestSetClaim_HappyPath(t *testing.T) {
	srv, _, store := newTestServerFull(t)
	seedFP(t, store, "1234567890abcdef")
	e := echo.New()

	body := map[string]interface{}{"claimedBy": "alice", "note": "investigating"}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("1234567890abcdef")

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
	seedFP(t, store, "1234567890abcdef")
	e := echo.New()
	body := map[string]interface{}{"note": "no user"}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("1234567890abcdef")

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
	seedFP(t, store, "deadbeef00000000")
	e := echo.New()
	seedClaimHTTP(t, srv, e, "deadbeef00000000", "bob")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("deadbeef00000000")
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
	seedFP(t, store, "deadbeef00000000")
	e := echo.New()
	seedClaimHTTP(t, srv, e, "deadbeef00000000", "carol")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodDelete, "/?by=carol", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("deadbeef00000000")
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
	c.SetParamValues("1234567890abcdef")

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
	c.SetParamValues("1234567890abcdef")

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
	seedFP(t, store, "1234567890abcdef")
	e := echo.New()
	seedClaimHTTP(t, srv, e, "1234567890abcdef", "dave")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("1234567890abcdef")
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

func TestSetClaim_TooLong(t *testing.T) {
	tests := []struct {
		name string
		body map[string]interface{}
	}{
		{"claimedBy too long", map[string]interface{}{"claimedBy": string(make([]rune, 101))}},
		{"note too long", map[string]interface{}{"claimedBy": "alice", "note": string(make([]rune, 1_001))}},
	}
	for _, tt := range tests { //nolint:dupl
		t.Run(tt.name, func(t *testing.T) {
			srv, _, store := newTestServerFull(t)
			seedFP(t, store, "1234567890abcdef")
			e := echo.New()
			b, _ := json.Marshal(tt.body)
			req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/", bytes.NewReader(b))
			req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)
			c.SetParamNames("fingerprint")
			c.SetParamValues("1234567890abcdef")

			err := srv.setClaim(c)
			if err == nil {
				t.Fatalf("expected error for %s", tt.name)
			}
			he, ok := err.(*echo.HTTPError)
			if !ok || he.Code != http.StatusBadRequest {
				t.Errorf("expected 400, got %v", err)
			}
		})
	}
}

func TestSetClaim_AuthMode_UsesContextUser(t *testing.T) { //nolint:dupl
	srv, _, store := newTestServerFull(t)
	srv.authProvider = auth.NewInternalProvider(srv.userStore)
	seedFP(t, store, "1234567890abcdef")
	e := echo.New()

	body := map[string]interface{}{"claimedBy": "spoofed", "note": "checking"}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("1234567890abcdef")
	c.Set(auth.ContextKey, &auth.User{ID: "u1", Username: "real-user", Role: "user", Provider: "internal"})

	if err := srv.setClaim(c); err != nil {
		t.Fatalf("setClaim: %v", err)
	}
	if !contains(rec.Body.String(), "real-user") || contains(rec.Body.String(), "spoofed") {
		t.Fatalf("expected context user as claimedBy, got: %s", rec.Body.String())
	}
}

func TestUpdateClaimNote_OwnerHappyPath(t *testing.T) {
	srv, alertStore, store := newTestServerFull(t)
	const fp = "1234567890abcdef"
	seedFP(t, store, fp)
	if _, err := store.SetClaim(fp, "", nil, "alice", "first"); err != nil {
		t.Fatalf("SetClaim: %v", err)
	}
	alertStore.SetActiveClaim(fp, "", &models.Claim{Fingerprint: fp, ClaimedBy: "alice", Note: "first"})

	e := echo.New()
	body := map[string]interface{}{"claimedBy": "alice", "note": "second"}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPatch, "/", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues(fp)

	if err := srv.updateClaimNote(c); err != nil {
		t.Fatalf("updateClaimNote: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	if !contains(rec.Body.String(), "second") {
		t.Errorf("expected new note in response: %s", rec.Body.String())
	}

	hist, _ := store.GetClaimHistory(fp, "")
	if len(hist) != 2 {
		t.Fatalf("expected 2 immutable rows, got %d", len(hist))
	}
}

func TestUpdateClaimNote_NotOwnerForbidden(t *testing.T) {
	srv, _, store := newTestServerFull(t)
	const fp = "1234567890abcdef"
	seedFP(t, store, fp)
	if _, err := store.SetClaim(fp, "", nil, "alice", "first"); err != nil {
		t.Fatalf("SetClaim: %v", err)
	}

	e := echo.New()
	body := map[string]interface{}{"claimedBy": "bob", "note": "hijack"}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPatch, "/", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues(fp)

	err := srv.updateClaimNote(c)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %v", err)
	}
}

func TestUpdateClaimNote_NoActiveClaim(t *testing.T) {
	srv, _, store := newTestServerFull(t)
	const fp = "1234567890abcdef"
	seedFP(t, store, fp)

	e := echo.New()
	body := map[string]interface{}{"claimedBy": "alice", "note": "x"}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPatch, "/", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues(fp)

	err := srv.updateClaimNote(c)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %v", err)
	}
}
