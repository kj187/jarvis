package alertmanager

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newAuthCapturingServer(t *testing.T, capturedReq *http.Request) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*capturedReq = *r
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("[]")) //nolint:errcheck
	}))
}

func TestNewClientWithAuth_BearerToken(t *testing.T) {
	var captured http.Request
	srv := newAuthCapturingServer(t, &captured)
	defer srv.Close()

	client := NewClientWithAuth(srv.URL, Auth{BearerToken: "tok123"})
	_, _ = client.GetAlerts(context.Background())

	got := captured.Header.Get("Authorization")
	if got != "Bearer tok123" {
		t.Errorf("Authorization = %q, want %q", got, "Bearer tok123")
	}
}

func TestNewClientWithAuth_BasicAuth(t *testing.T) {
	var captured http.Request
	srv := newAuthCapturingServer(t, &captured)
	defer srv.Close()

	client := NewClientWithAuth(srv.URL, Auth{BasicUser: "jarvis", BasicPass: "s3cr3t"})
	_, _ = client.GetAlerts(context.Background())

	got := captured.Header.Get("Authorization")
	want := "Basic " + base64.StdEncoding.EncodeToString([]byte("jarvis:s3cr3t"))
	if got != want {
		t.Errorf("Authorization = %q, want %q", got, want)
	}
}

func TestNewClientWithAuth_CustomHeaders(t *testing.T) {
	var captured http.Request
	srv := newAuthCapturingServer(t, &captured)
	defer srv.Close()

	client := NewClientWithAuth(srv.URL, Auth{Headers: map[string]string{
		"X-Scope-OrgID": "tenant1",
		"X-Custom":      "hello",
	}})
	_, _ = client.GetAlerts(context.Background())

	if captured.Header.Get("X-Scope-OrgID") != "tenant1" {
		t.Errorf("X-Scope-OrgID = %q, want tenant1", captured.Header.Get("X-Scope-OrgID"))
	}
	if captured.Header.Get("X-Custom") != "hello" {
		t.Errorf("X-Custom = %q, want hello", captured.Header.Get("X-Custom"))
	}
}

func TestNewClientWithAuth_BearerOverridesCustomAuthHeader(t *testing.T) {
	var captured http.Request
	srv := newAuthCapturingServer(t, &captured)
	defer srv.Close()

	// BearerToken must win over a custom Authorization header.
	client := NewClientWithAuth(srv.URL, Auth{
		BearerToken: "winner",
		Headers:     map[string]string{"Authorization": "Custom loser"},
	})
	_, _ = client.GetAlerts(context.Background())

	got := captured.Header.Get("Authorization")
	if !strings.HasPrefix(got, "Bearer winner") {
		t.Errorf("Authorization = %q, want Bearer winner to win", got)
	}
}

func TestNewClientWithAuth_BasicOverridesCustomAuthHeader(t *testing.T) {
	var captured http.Request
	srv := newAuthCapturingServer(t, &captured)
	defer srv.Close()

	client := NewClientWithAuth(srv.URL, Auth{
		BasicUser: "u",
		BasicPass: "p",
		Headers:   map[string]string{"Authorization": "Custom loser"},
	})
	_, _ = client.GetAlerts(context.Background())

	got := captured.Header.Get("Authorization")
	want := "Basic " + base64.StdEncoding.EncodeToString([]byte("u:p"))
	if got != want {
		t.Errorf("Authorization = %q, want %q", got, want)
	}
}

func TestNewClientWithAuth_NoAuth_NoAuthHeader(t *testing.T) {
	var captured http.Request
	srv := newAuthCapturingServer(t, &captured)
	defer srv.Close()

	client := NewClientWithAuth(srv.URL, Auth{})
	_, _ = client.GetAlerts(context.Background())

	if got := captured.Header.Get("Authorization"); got != "" {
		t.Errorf("Authorization = %q, want empty when no auth configured", got)
	}
}

func TestNewClientWithAuth_AllOptions(t *testing.T) {
	var captured http.Request
	srv := newAuthCapturingServer(t, &captured)
	defer srv.Close()

	// When both BearerToken and BasicUser set, BearerToken wins.
	client := NewClientWithAuth(srv.URL, Auth{
		BearerToken: "tok",
		BasicUser:   "u",
		BasicPass:   "p",
		Headers:     map[string]string{"X-Extra": "extra"},
	})
	_, _ = client.GetAlerts(context.Background())

	if got := captured.Header.Get("Authorization"); got != "Bearer tok" {
		t.Errorf("Authorization = %q, want Bearer tok", got)
	}
	if got := captured.Header.Get("X-Extra"); got != "extra" {
		t.Errorf("X-Extra = %q, want extra", got)
	}
}
