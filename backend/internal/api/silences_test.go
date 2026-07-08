package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	amclient "github.com/kj187/jarvis/backend/internal/alertmanager"
	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/metrics"
	"github.com/kj187/jarvis/backend/internal/users"
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
	userStore := users.NewStore(database, dialect)
	hub := ws.NewHub(nil, nil, metrics.New("test"))
	go hub.Run()

	registry := cluster.NewRegistry([]config.ClusterConfig{
		{Name: "testcluster", AlertmanagerURL: amURL, AlertmanagerLinkURL: amURL},
	})
	cfg := &config.Config{}
	return NewServer(alertStore, history.NewSilenceStore(), store, hub, registry, cfg, nil, auth.NoneProvider{}, userStore)
}

// fakeTriggerer records poll-trigger requests from mutation handlers.
type fakeTriggerer struct{ calls int }

func (f *fakeTriggerer) Trigger() { f.calls++ }

// guardAM builds an Alertmanager test server that fails the test on ANY
// request — GET /api/v1/silences must be served purely from the snapshot.
func guardAM(t *testing.T) *httptest.Server {
	t.Helper()
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("alertmanager must not be called, got %s %s", r.Method, r.URL.Path)
		http.Error(w, "unexpected call", http.StatusInternalServerError)
	}))
	t.Cleanup(am.Close)
	return am
}

func testGettableSilence(id string) amclient.GettableSilence {
	now := time.Now().UTC()
	return amclient.GettableSilence{
		ID:        id,
		Matchers:  []amclient.AMSilenceMatcher{{Name: "alertname", Value: "Test", IsEqual: true}},
		CreatedBy: "alice",
		Comment:   "test silence",
		StartsAt:  now,
		EndsAt:    now.Add(time.Hour),
		Status:    amclient.AMSilenceStatus{State: "active"},
		UpdatedAt: now,
	}
}

func TestGetSilences_EmptyStore_ReturnsEmptyArray(t *testing.T) {
	srv := newTestServerWithAM(t, guardAM(t).URL)
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

func TestGetSilences_ServedFromSnapshot_NoAMCall(t *testing.T) {
	srv := newTestServerWithAM(t, guardAM(t).URL)
	srv.silenceStore.Set("testcluster", []amclient.GettableSilence{testGettableSilence("silence-1")})

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
	if !contains(rec.Body.String(), `"clusterName":"testcluster"`) {
		t.Errorf("expected clusterName in response: %s", rec.Body.String())
	}
}

func TestGetSilences_WithClusterFilter(t *testing.T) {
	am := guardAM(t)
	registry := cluster.NewRegistry([]config.ClusterConfig{
		{Name: "alpha", AlertmanagerURL: am.URL, AlertmanagerLinkURL: am.URL},
		{Name: "beta", AlertmanagerURL: am.URL, AlertmanagerLinkURL: am.URL},
	})
	srv := newTestServerWithRegistry(t, registry)
	srv.silenceStore.Set("alpha", []amclient.GettableSilence{testGettableSilence("sil-alpha")})
	srv.silenceStore.Set("beta", []amclient.GettableSilence{testGettableSilence("sil-beta")})

	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/silences?cluster=beta", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := srv.getSilences(c); err != nil {
		t.Fatalf("getSilences: %v", err)
	}
	if contains(rec.Body.String(), "sil-alpha") {
		t.Errorf("cluster filter leaked alpha silences: %s", rec.Body.String())
	}
	if !contains(rec.Body.String(), "sil-beta") {
		t.Errorf("expected sil-beta in response: %s", rec.Body.String())
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
		"matchers":  []interface{}{map[string]interface{}{"name": "alertname", "isEqual": true, "isRegex": false, "value": "Test"}},
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
		"matchers":  []interface{}{map[string]interface{}{"name": "alertname", "isEqual": true, "isRegex": false, "value": "Test"}},
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
	if strings.Contains(he.Message.(string), "AM error") {
		t.Fatalf("expected generic error message, got: %v", he.Message)
	}
}

func TestCreateSilence_ExpireOldSilenceWhenAMReturnsNewID(t *testing.T) {
	deletedIDs := make([]string, 0)
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/silences") {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(amclient.PostSilenceResponse{SilenceID: "new-silence-id"}) //nolint:errcheck
			return
		}
		if r.Method == http.MethodDelete {
			// capture the ID being deleted
			parts := strings.Split(r.URL.Path, "/")
			deletedIDs = append(deletedIDs, parts[len(parts)-1])
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer am.Close()

	srv := newTestServerWithAM(t, am.URL)
	e := echo.New()

	now := time.Now().UTC()
	body := map[string]interface{}{
		"cluster":   "testcluster",
		"id":        "old-silence-id",
		"matchers":  []interface{}{map[string]interface{}{"name": "alertname", "isEqual": true, "isRegex": false, "value": "Test"}},
		"startsAt":  now.Format(time.RFC3339),
		"endsAt":    now.Add(time.Hour).Format(time.RFC3339),
		"createdBy": "alice",
		"comment":   "extend silence",
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
	if !contains(rec.Body.String(), "new-silence-id") {
		t.Errorf("expected new-silence-id in response: %s", rec.Body.String())
	}
	if len(deletedIDs) != 1 || deletedIDs[0] != "old-silence-id" {
		t.Errorf("expected old-silence-id to be deleted, got: %v", deletedIDs)
	}
}

func TestCreateSilence_NoDeleteWhenSameIDReturned(t *testing.T) {
	deleteCallCount := 0
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			deleteCallCount++
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(amclient.PostSilenceResponse{SilenceID: "same-silence-id"}) //nolint:errcheck
	}))
	defer am.Close()

	srv := newTestServerWithAM(t, am.URL)
	e := echo.New()

	now := time.Now().UTC()
	body := map[string]interface{}{
		"cluster":   "testcluster",
		"id":        "same-silence-id",
		"matchers":  []interface{}{map[string]interface{}{"name": "alertname", "isEqual": true, "isRegex": false, "value": "Test"}},
		"startsAt":  now.Format(time.RFC3339),
		"endsAt":    now.Add(time.Hour).Format(time.RFC3339),
		"createdBy": "alice",
		"comment":   "extend silence",
	}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/silences", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := srv.createSilence(c); err != nil {
		t.Fatalf("createSilence: %v", err)
	}
	if deleteCallCount != 0 {
		t.Errorf("expected no DELETE call when AM returns same ID, got %d", deleteCallCount)
	}
}

func TestCreateSilence_AuthMode_UsesContextUserForAudit(t *testing.T) {
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(amclient.PostSilenceResponse{SilenceID: "new-silence"}) //nolint:errcheck
	}))
	defer am.Close()

	srv := newTestServerWithAM(t, am.URL)
	srv.authProvider = auth.NewInternalProvider(srv.userStore)
	seedFP(t, srv.store, "1234567890abcdef")
	e := echo.New()

	now := time.Now().UTC()
	body := map[string]interface{}{
		"cluster":     "testcluster",
		"matchers":    []interface{}{map[string]interface{}{"name": "alertname", "isEqual": true, "isRegex": false, "value": "Test"}},
		"startsAt":    now.Format(time.RFC3339),
		"endsAt":      now.Add(time.Hour).Format(time.RFC3339),
		"createdBy":   "spoofed",
		"performedBy": "spoofed",
		"comment":     "test silence",
		"fingerprint": "1234567890abcdef",
	}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/silences", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(auth.ContextKey, &auth.User{ID: "u1", Username: "real-user", Role: "user", Provider: "internal"})

	if err := srv.createSilence(c); err != nil {
		t.Fatalf("createSilence: %v", err)
	}

	events, err := srv.store.GetSilenceEvents("1234567890abcdef")
	if err != nil {
		t.Fatalf("GetSilenceEvents: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 silence event, got %d", len(events))
	}
	if events[0].PerformedBy != "real-user" {
		t.Fatalf("performedBy = %q, want real-user", events[0].PerformedBy)
	}
}

func TestCreateSilence_Validation(t *testing.T) {
	now := time.Now().UTC()
	validMatchers := []interface{}{map[string]interface{}{"name": "alertname", "isEqual": true, "isRegex": false, "value": "Test"}}

	tests := []struct {
		name string
		body map[string]interface{}
	}{
		{
			name: "empty matcher list",
			body: map[string]interface{}{
				"cluster": "testcluster", "matchers": []interface{}{},
				"startsAt": now.Format(time.RFC3339), "endsAt": now.Add(time.Hour).Format(time.RFC3339),
				"createdBy": "alice", "comment": "test",
			},
		},
		{
			name: "matcher with empty name",
			body: map[string]interface{}{
				"cluster":  "testcluster",
				"matchers": []interface{}{map[string]interface{}{"name": "", "isEqual": true, "isRegex": false, "value": "x"}},
				"startsAt": now.Format(time.RFC3339), "endsAt": now.Add(time.Hour).Format(time.RFC3339),
				"createdBy": "alice", "comment": "test",
			},
		},
		{
			name: "matcher with invalid regex",
			body: map[string]interface{}{
				"cluster":  "testcluster",
				"matchers": []interface{}{map[string]interface{}{"name": "instance", "isEqual": true, "isRegex": true, "value": "a("}},
				"startsAt": now.Format(time.RFC3339), "endsAt": now.Add(time.Hour).Format(time.RFC3339),
				"createdBy": "alice", "comment": "test",
			},
		},
		{
			name: "only a matcher matching the empty string",
			body: map[string]interface{}{
				"cluster":  "testcluster",
				"matchers": []interface{}{map[string]interface{}{"name": "instance", "isEqual": true, "isRegex": false, "value": ""}},
				"startsAt": now.Format(time.RFC3339), "endsAt": now.Add(time.Hour).Format(time.RFC3339),
				"createdBy": "alice", "comment": "test",
			},
		},
		{
			name: "endsAt before startsAt",
			body: map[string]interface{}{
				"cluster": "testcluster", "matchers": validMatchers,
				"startsAt": now.Format(time.RFC3339), "endsAt": now.Add(-time.Hour).Format(time.RFC3339),
				"createdBy": "alice", "comment": "test",
			},
		},
		{
			name: "endsAt in the past",
			body: map[string]interface{}{
				"cluster": "testcluster", "matchers": validMatchers,
				"startsAt": now.Add(-2 * time.Hour).Format(time.RFC3339), "endsAt": now.Add(-time.Hour).Format(time.RFC3339),
				"createdBy": "alice", "comment": "test",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				t.Fatal("alertmanager should not be called when validation fails")
			}))
			defer am.Close()

			srv := newTestServerWithAM(t, am.URL)
			e := echo.New()
			b, _ := json.Marshal(tt.body)
			req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/silences", bytes.NewReader(b))
			req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)

			err := srv.createSilence(c)
			if err == nil {
				t.Fatal("expected validation error")
			}
			he, ok := err.(*echo.HTTPError)
			if !ok || he.Code != http.StatusBadRequest {
				t.Errorf("expected 400, got %v", err)
			}
		})
	}
}

// A valid RE2 pattern using inline-flag syntax (e.g. `(?i)`) that a browser's
// JS RegExp can't compile must still be accepted server-side — Go's regexp
// package is RE2, the same engine Alertmanager uses.
func TestCreateSilence_AcceptsRE2OnlySyntax(t *testing.T) {
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
		"matchers":  []interface{}{map[string]interface{}{"name": "alertname", "isEqual": true, "isRegex": true, "value": "(?i)watchdog"}},
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
}

func TestCreateSilence_AMValidationErrorPassthrough(t *testing.T) {
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"message": "silence must not match all alerts"}`))
	}))
	defer am.Close()

	srv := newTestServerWithAM(t, am.URL)
	e := echo.New()

	now := time.Now().UTC()
	body := map[string]interface{}{
		"cluster":   "testcluster",
		"matchers":  []interface{}{map[string]interface{}{"name": "alertname", "isEqual": true, "isRegex": false, "value": "Test"}},
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

	err := srv.createSilence(c)
	if err == nil {
		t.Fatal("expected error for AM 400")
	}
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %v", err)
	}
	if !contains(he.Message.(string), "silence must not match all alerts") {
		t.Errorf("expected AM message relayed, got: %v", he.Message)
	}
}

func TestDeleteSilence_AMValidationErrorPassthrough(t *testing.T) {
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "silence already expired", http.StatusGone)
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
		t.Fatal("expected error")
	}
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for AM 4xx passthrough, got %v", err)
	}
}

func TestCreateSilence_WriteThroughToSnapshot(t *testing.T) {
	tests := []struct {
		name          string
		startsAtDelta time.Duration
		wantState     string
	}{
		{"immediate start is active", 0, "active"},
		{"future start is pending", time.Hour, "pending"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(amclient.PostSilenceResponse{SilenceID: "wt-1"}) //nolint:errcheck
			}))
			defer am.Close()

			srv := newTestServerWithAM(t, am.URL)
			ft := &fakeTriggerer{}
			srv.pollTrigger = ft
			e := echo.New()

			now := time.Now().UTC()
			body := map[string]interface{}{
				"cluster":   "testcluster",
				"matchers":  []interface{}{map[string]interface{}{"name": "alertname", "isEqual": true, "isRegex": false, "value": "Test"}},
				"startsAt":  now.Add(tt.startsAtDelta).Format(time.RFC3339),
				"endsAt":    now.Add(2 * time.Hour).Format(time.RFC3339),
				"createdBy": "alice",
				"comment":   "write-through",
			}
			b, _ := json.Marshal(body)
			req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/silences", bytes.NewReader(b))
			req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)

			if err := srv.createSilence(c); err != nil {
				t.Fatalf("createSilence: %v", err)
			}

			snap := srv.silenceStore.GetCluster("testcluster")
			if len(snap) != 1 || snap[0].ID != "wt-1" {
				t.Fatalf("snapshot = %+v, want [wt-1]", snap)
			}
			if snap[0].Status.State != tt.wantState {
				t.Errorf("state = %q, want %q", snap[0].Status.State, tt.wantState)
			}
			if snap[0].CreatedBy != "alice" || snap[0].Comment != "write-through" {
				t.Errorf("snapshot entry incomplete: %+v", snap[0])
			}
			if ft.calls != 1 {
				t.Errorf("poll trigger calls = %d, want 1", ft.calls)
			}
		})
	}
}

func TestCreateSilence_UpdateIDChange_ExpiresOldInSnapshot(t *testing.T) {
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodPost {
			json.NewEncoder(w).Encode(amclient.PostSilenceResponse{SilenceID: "new-id"}) //nolint:errcheck
		}
	}))
	defer am.Close()

	srv := newTestServerWithAM(t, am.URL)
	ft := &fakeTriggerer{}
	srv.pollTrigger = ft
	srv.silenceStore.Set("testcluster", []amclient.GettableSilence{testGettableSilence("old-id")})
	e := echo.New()

	now := time.Now().UTC()
	body := map[string]interface{}{
		"cluster":   "testcluster",
		"id":        "old-id",
		"matchers":  []interface{}{map[string]interface{}{"name": "alertname", "isEqual": true, "isRegex": false, "value": "Test"}},
		"startsAt":  now.Format(time.RFC3339),
		"endsAt":    now.Add(time.Hour).Format(time.RFC3339),
		"createdBy": "alice",
		"comment":   "edited",
	}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/silences", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := srv.createSilence(c); err != nil {
		t.Fatalf("createSilence: %v", err)
	}

	snap := srv.silenceStore.GetCluster("testcluster")
	states := map[string]string{}
	for _, s := range snap {
		states[s.ID] = s.Status.State
	}
	if states["old-id"] != "expired" {
		t.Errorf("old-id state = %q, want expired (snapshot: %+v)", states["old-id"], snap)
	}
	if states["new-id"] != "active" {
		t.Errorf("new-id state = %q, want active (snapshot: %+v)", states["new-id"], snap)
	}
	if ft.calls != 1 {
		t.Errorf("poll trigger calls = %d, want 1", ft.calls)
	}
}

func TestDeleteSilence_WriteThroughMarksExpired(t *testing.T) {
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer am.Close()

	srv := newTestServerWithAM(t, am.URL)
	ft := &fakeTriggerer{}
	srv.pollTrigger = ft
	srv.silenceStore.Set("testcluster", []amclient.GettableSilence{testGettableSilence("silence-1")})
	e := echo.New()

	req := httptest.NewRequestWithContext(context.Background(), http.MethodDelete, "/?cluster=testcluster", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("silence-1")

	if err := srv.deleteSilence(c); err != nil {
		t.Fatalf("deleteSilence: %v", err)
	}

	snap := srv.silenceStore.GetCluster("testcluster")
	if len(snap) != 1 || snap[0].Status.State != "expired" {
		t.Errorf("snapshot = %+v, want silence-1 expired", snap)
	}
	if ft.calls != 1 {
		t.Errorf("poll trigger calls = %d, want 1", ft.calls)
	}
}
