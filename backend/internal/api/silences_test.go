package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	amclient "github.com/kj187/jarvis/backend/internal/alertmanager"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/ws"
	"github.com/labstack/echo/v4"
)

// newTestServerWithAM builds a Server wired to a real httptest Alertmanager.
func newTestServerWithAM(t *testing.T, amURL string) *Server {
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

	registry := cluster.NewRegistry([]config.ClusterConfig{
		{Name: "testcluster", AlertmanagerURL: amURL, AlertmanagerLinkURL: amURL},
	})
	cfg := &config.Config{}
	return NewServer(alertStore, store, hub, registry, cfg, nil)
}

func TestGetSilences_Empty(t *testing.T) {
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]amclient.GettableSilence{}) //nolint:errcheck
	}))
	defer am.Close()

	srv := newTestServerWithAM(t, am.URL)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/silences", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := srv.getSilences(c); err != nil {
		t.Fatalf("getSilences: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	if rec.Body.String() != "[]\n" {
		t.Errorf("expected empty array, got %s", rec.Body.String())
	}
}

func TestGetSilences_WithData(t *testing.T) {
	now := time.Now().UTC()
	silences := []amclient.GettableSilence{
		{
			ID:        "silence-1",
			CreatedBy: "alice",
			Comment:   "test silence",
			StartsAt:  now,
			EndsAt:    now.Add(time.Hour),
			Status:    amclient.AMSilenceStatus{State: "active"},
		},
	}
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(silences) //nolint:errcheck
	}))
	defer am.Close()

	srv := newTestServerWithAM(t, am.URL)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/silences", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := srv.getSilences(c); err != nil {
		t.Fatalf("getSilences: %v", err)
	}
	if !contains(rec.Body.String(), "silence-1") {
		t.Errorf("expected silence-1 in response: %s", rec.Body.String())
	}
}

func TestGetSilences_WithClusterFilter(t *testing.T) {
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]amclient.GettableSilence{}) //nolint:errcheck
	}))
	defer am.Close()

	srv := newTestServerWithAM(t, am.URL)
	e := echo.New()

	// Filter by existing cluster
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/silences?cluster=testcluster", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := srv.getSilences(c); err != nil {
		t.Fatalf("getSilences: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
}

func TestGetSilences_AMError_BestEffort(t *testing.T) {
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "internal error", http.StatusInternalServerError)
	}))
	defer am.Close()

	srv := newTestServerWithAM(t, am.URL)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/silences", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	// AM error is best-effort — getSilences should not return error, just empty list
	if err := srv.getSilences(c); err != nil {
		t.Fatalf("getSilences: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
}

func TestCreateSilence_HappyPath(t *testing.T) {
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(amclient.PostSilenceResponse{SilenceID: "new-silence"}) //nolint:errcheck
	}))
	defer am.Close()

	srv := newTestServerWithAM(t, am.URL)
	e := echo.New()

	now := time.Now().UTC()
	body := map[string]interface{}{
		"cluster":   "testcluster",
		"matchers":  []interface{}{},
		"startsAt":  now.Format(time.RFC3339),
		"endsAt":    now.Add(time.Hour).Format(time.RFC3339),
		"createdBy": "alice",
		"comment":   "test silence",
	}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/silences", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := srv.createSilence(c); err != nil {
		t.Fatalf("createSilence: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want 201", rec.Code)
	}
	if !contains(rec.Body.String(), "new-silence") {
		t.Errorf("expected silence id in response: %s", rec.Body.String())
	}
}

func TestCreateSilence_MissingComment(t *testing.T) {
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer am.Close()

	srv := newTestServerWithAM(t, am.URL)
	e := echo.New()

	now := time.Now().UTC()
	body := map[string]interface{}{
		"cluster":   "testcluster",
		"matchers":  []interface{}{},
		"startsAt":  now.Format(time.RFC3339),
		"endsAt":    now.Add(time.Hour).Format(time.RFC3339),
		"createdBy": "alice",
		// comment missing
	}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/silences", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := srv.createSilence(c)
	if err == nil {
		t.Fatal("expected error for missing comment")
	}
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %v", err)
	}
}

func TestCreateSilence_MissingCluster(t *testing.T) {
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer am.Close()

	srv := newTestServerWithAM(t, am.URL)
	e := echo.New()

	now := time.Now().UTC()
	body := map[string]interface{}{
		// cluster missing
		"matchers":  []interface{}{},
		"startsAt":  now.Format(time.RFC3339),
		"endsAt":    now.Add(time.Hour).Format(time.RFC3339),
		"createdBy": "alice",
		"comment":   "test",
	}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/silences", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := srv.createSilence(c)
	if err == nil {
		t.Fatal("expected error for missing cluster")
	}
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %v", err)
	}
}

func TestCreateSilence_UnknownCluster(t *testing.T) {
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer am.Close()

	srv := newTestServerWithAM(t, am.URL)
	e := echo.New()

	now := time.Now().UTC()
	body := map[string]interface{}{
		"cluster":   "nonexistent",
		"matchers":  []interface{}{},
		"startsAt":  now.Format(time.RFC3339),
		"endsAt":    now.Add(time.Hour).Format(time.RFC3339),
		"createdBy": "alice",
		"comment":   "test",
	}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/silences", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := srv.createSilence(c)
	if err == nil {
		t.Fatal("expected error for unknown cluster")
	}
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %v", err)
	}
}

func TestCreateSilence_AMError(t *testing.T) {
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "alertmanager error", http.StatusInternalServerError)
	}))
	defer am.Close()

	srv := newTestServerWithAM(t, am.URL)
	e := echo.New()

	now := time.Now().UTC()
	body := map[string]interface{}{
		"cluster":   "testcluster",
		"matchers":  []interface{}{},
		"startsAt":  now.Format(time.RFC3339),
		"endsAt":    now.Add(time.Hour).Format(time.RFC3339),
		"createdBy": "alice",
		"comment":   "test",
	}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/silences", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := srv.createSilence(c)
	if err == nil {
		t.Fatal("expected error for AM failure")
	}
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusBadGateway {
		t.Errorf("expected 502, got %v", err)
	}
}

func TestDeleteSilence_Success(t *testing.T) {
	tests := []struct {
		name string
		url  string
	}{
		{"basic", "/?cluster=testcluster"},
		{"with fingerprint event", "/?cluster=testcluster&fingerprint=abc123&by=alice"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusOK)
			}))
			defer am.Close()

			srv := newTestServerWithAM(t, am.URL)
			e := echo.New()
			req := httptest.NewRequestWithContext(context.Background(), http.MethodDelete, tt.url, nil)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)
			c.SetParamNames("id")
			c.SetParamValues("silence-1")

			if err := srv.deleteSilence(c); err != nil {
				t.Fatalf("deleteSilence: %v", err)
			}
			if rec.Code != http.StatusNoContent {
				t.Errorf("status = %d, want 204", rec.Code)
			}
		})
	}
}

func TestDeleteSilence_ClusterErrors(t *testing.T) {
	tests := []struct {
		name string
		url  string
	}{
		{"missing cluster", "/"},
		{"unknown cluster", "/?cluster=nonexistent"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusOK)
			}))
			defer am.Close()

			srv := newTestServerWithAM(t, am.URL)
			e := echo.New()
			req := httptest.NewRequestWithContext(context.Background(), http.MethodDelete, tt.url, nil)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)
			c.SetParamNames("id")
			c.SetParamValues("silence-1")

			err := srv.deleteSilence(c)
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

func TestDeleteSilence_AMError(t *testing.T) {
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "AM error", http.StatusInternalServerError)
	}))
	defer am.Close()

	srv := newTestServerWithAM(t, am.URL)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodDelete, "/?cluster=testcluster", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("silence-1")

	err := srv.deleteSilence(c)
	if err == nil {
		t.Fatal("expected error for AM failure")
	}
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusBadGateway {
		t.Errorf("expected 502, got %v", err)
	}
}
