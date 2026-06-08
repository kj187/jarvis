package alertmanager

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestGetAlerts(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	alerts := []GettableAlert{
		{
			Fingerprint: "abc123",
			Status:      GettableAlertStatus{State: "active"},
			Labels:      map[string]string{"alertname": "TestAlert"},
			StartsAt:    now,
			EndsAt:      now.Add(time.Hour),
			UpdatedAt:   now,
		},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v2/alerts" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(alerts) //nolint:errcheck
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	got, err := client.GetAlerts(context.Background())
	if err != nil {
		t.Fatalf("GetAlerts() error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len(alerts) = %d, want 1", len(got))
	}
	if got[0].Fingerprint != "abc123" {
		t.Errorf("Fingerprint = %q", got[0].Fingerprint)
	}
}

func TestGetSilences(t *testing.T) {
	now := time.Now().UTC()
	silences := []GettableSilence{
		{
			ID:        "silence-1",
			CreatedBy: "test",
			Comment:   "test silence",
			StartsAt:  now,
			EndsAt:    now.Add(time.Hour),
			Status:    AMSilenceStatus{State: "active"},
		},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(silences) //nolint:errcheck
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	got, err := client.GetSilences(context.Background())
	if err != nil {
		t.Fatalf("GetSilences() error: %v", err)
	}
	if len(got) != 1 || got[0].ID != "silence-1" {
		t.Errorf("unexpected silences: %+v", got)
	}
}

func TestPing_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AMStatus{Status: "success"}) //nolint:errcheck
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	if err := client.Ping(context.Background()); err != nil {
		t.Fatalf("Ping() error: %v", err)
	}
}

func TestPing_Failure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "service unavailable", http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	if err := client.Ping(context.Background()); err == nil {
		t.Fatal("expected error for 503 response, got nil")
	}
}

func TestCreateSilence(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(PostSilenceResponse{SilenceID: "new-silence-id"}) //nolint:errcheck
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	id, err := client.CreateSilence(context.Background(), PostableSilence{
		CreatedBy: "tester",
		Comment:   "test",
		StartsAt:  time.Now(),
		EndsAt:    time.Now().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateSilence() error: %v", err)
	}
	if id != "new-silence-id" {
		t.Errorf("silence ID = %q, want new-silence-id", id)
	}
}

func TestDeleteSilence(t *testing.T) {
	deleted := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete && r.URL.Path == "/api/v2/silence/silence-1" {
			deleted = true
			w.WriteHeader(http.StatusOK)
			return
		}
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	if err := client.DeleteSilence(context.Background(), "silence-1"); err != nil {
		t.Fatalf("DeleteSilence() error: %v", err)
	}
	if !deleted {
		t.Error("DELETE request was not made")
	}
}
