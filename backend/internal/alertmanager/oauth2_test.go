package alertmanager

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func newTokenServer(t *testing.T, token string, expiresIn int, statusCode int) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/x-www-form-urlencoded" {
			http.Error(w, "wrong content-type: "+ct, http.StatusBadRequest)
			return
		}
		if statusCode != http.StatusOK {
			http.Error(w, "token error", statusCode)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(tokenResponse{ //nolint:errcheck
			AccessToken: token,
			ExpiresIn:   expiresIn,
			TokenType:   "Bearer",
		})
	}))
	return srv, &calls
}

func TestOAuth2TokenSource_FetchToken(t *testing.T) {
	srv, calls := newTokenServer(t, "tok-abc", 300, http.StatusOK)
	defer srv.Close()

	src := newOAuth2TokenSource(OAuth2ClientConfig{
		ClientID:     "cid",
		ClientSecret: "csec",
		TokenURL:     srv.URL,
	})

	tok, err := src.Token(context.Background())
	if err != nil {
		t.Fatalf("Token() error: %v", err)
	}
	if tok != "tok-abc" {
		t.Errorf("token = %q, want tok-abc", tok)
	}
	if calls.Load() != 1 {
		t.Errorf("token endpoint called %d times, want 1", calls.Load())
	}
}

func TestOAuth2TokenSource_TokenCached(t *testing.T) {
	srv, calls := newTokenServer(t, "tok-cached", 300, http.StatusOK)
	defer srv.Close()

	src := newOAuth2TokenSource(OAuth2ClientConfig{
		ClientID: "cid", ClientSecret: "csec", TokenURL: srv.URL,
	})

	for i := range 3 {
		if _, err := src.Token(context.Background()); err != nil {
			t.Fatalf("Token() call %d error: %v", i, err)
		}
	}
	if calls.Load() != 1 {
		t.Errorf("token endpoint called %d times, want 1 (cache should prevent re-fetch)", calls.Load())
	}
}

func TestOAuth2TokenSource_RefreshWhenNearExpiry(t *testing.T) {
	srv, calls := newTokenServer(t, "tok-fresh", 300, http.StatusOK)
	defer srv.Close()

	src := newOAuth2TokenSource(OAuth2ClientConfig{
		ClientID: "cid", ClientSecret: "csec", TokenURL: srv.URL,
	})

	// Manually prime the cache with a token expiring within tokenRefreshBuffer.
	src.mu.Lock()
	src.accessToken = "tok-stale"
	src.expiresAt = time.Now().Add(10 * time.Second) // within 30s buffer
	src.mu.Unlock()

	tok, err := src.Token(context.Background())
	if err != nil {
		t.Fatalf("Token() error: %v", err)
	}
	if tok != "tok-fresh" {
		t.Errorf("token = %q, want tok-fresh (should have refreshed)", tok)
	}
	if calls.Load() != 1 {
		t.Errorf("expected 1 fetch call, got %d", calls.Load())
	}
}

func TestOAuth2TokenSource_InvalidateForcesFetch(t *testing.T) {
	srv, calls := newTokenServer(t, "tok-new", 300, http.StatusOK)
	defer srv.Close()

	src := newOAuth2TokenSource(OAuth2ClientConfig{
		ClientID: "cid", ClientSecret: "csec", TokenURL: srv.URL,
	})

	if _, err := src.Token(context.Background()); err != nil {
		t.Fatalf("first Token() error: %v", err)
	}
	src.invalidate()
	if _, err := src.Token(context.Background()); err != nil {
		t.Fatalf("second Token() error: %v", err)
	}

	if calls.Load() != 2 {
		t.Errorf("expected 2 fetch calls after invalidate, got %d", calls.Load())
	}
}

func TestOAuth2TokenSource_EndpointError(t *testing.T) {
	srv, _ := newTokenServer(t, "", 0, http.StatusUnauthorized)
	defer srv.Close()

	src := newOAuth2TokenSource(OAuth2ClientConfig{
		ClientID: "cid", ClientSecret: "csec", TokenURL: srv.URL,
	})
	_, err := src.Token(context.Background())
	if err == nil {
		t.Error("expected error for 401 token endpoint, got nil")
	}
}

func TestOAuth2TokenSource_FallbackTTL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// expires_in omitted → should use tokenFallbackTTL
		json.NewEncoder(w).Encode(map[string]string{"access_token": "tok-fallback"}) //nolint:errcheck
	}))
	defer srv.Close()

	src := newOAuth2TokenSource(OAuth2ClientConfig{
		ClientID: "cid", ClientSecret: "csec", TokenURL: srv.URL,
	})
	if _, err := src.Token(context.Background()); err != nil {
		t.Fatalf("Token() error: %v", err)
	}
	src.mu.Lock()
	ttl := time.Until(src.expiresAt)
	src.mu.Unlock()

	// Should be close to tokenFallbackTTL (5 min), definitely > 4 min
	if ttl < 4*time.Minute {
		t.Errorf("fallback TTL = %v, want ~%v", ttl, tokenFallbackTTL)
	}
}

func TestOAuth2TokenSource_ScopesInRequest(t *testing.T) {
	var capturedScope string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := make([]byte, 4096)
		n, _ := r.Body.Read(body)
		vals, _ := url.ParseQuery(string(body[:n]))
		capturedScope = vals.Get("scope")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(tokenResponse{AccessToken: "tok", ExpiresIn: 300}) //nolint:errcheck
	}))
	defer srv.Close()

	src := newOAuth2TokenSource(OAuth2ClientConfig{
		ClientID: "cid", ClientSecret: "csec", TokenURL: srv.URL,
		Scopes: []string{"openid", "profile"},
	})
	if _, err := src.Token(context.Background()); err != nil {
		t.Fatalf("Token() error: %v", err)
	}
	if capturedScope != "openid profile" {
		t.Errorf("scope = %q, want %q", capturedScope, "openid profile")
	}
}

func TestOAuth2RoundTripper_InjectsToken(t *testing.T) {
	tokenSrv, _ := newTokenServer(t, "bearer-tok", 300, http.StatusOK)
	defer tokenSrv.Close()

	var capturedAuth string
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("[]")) //nolint:errcheck
	}))
	defer apiSrv.Close()

	client := NewClientWithAuth(apiSrv.URL, Auth{
		OAuth2: &OAuth2ClientConfig{
			ClientID: "cid", ClientSecret: "csec", TokenURL: tokenSrv.URL,
		},
	})
	if _, err := client.GetAlerts(context.Background()); err != nil {
		t.Fatalf("GetAlerts() error: %v", err)
	}
	if capturedAuth != "Bearer bearer-tok" {
		t.Errorf("Authorization = %q, want %q", capturedAuth, "Bearer bearer-tok")
	}
}

func TestOAuth2RoundTripper_RetriesOn401(t *testing.T) {
	// First token fetch → "stale-tok", second → "fresh-tok"
	callCount := 0
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		tok := "stale-tok"
		if callCount > 1 {
			tok = "fresh-tok"
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(tokenResponse{AccessToken: tok, ExpiresIn: 300}) //nolint:errcheck
	}))
	defer tokenSrv.Close()

	apiCallCount := 0
	var lastAuth string
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiCallCount++
		lastAuth = r.Header.Get("Authorization")
		if apiCallCount == 1 {
			// Simulate expired token on first call
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("[]")) //nolint:errcheck
	}))
	defer apiSrv.Close()

	client := NewClientWithAuth(apiSrv.URL, Auth{
		OAuth2: &OAuth2ClientConfig{
			ClientID: "cid", ClientSecret: "csec", TokenURL: tokenSrv.URL,
		},
	})
	if _, err := client.GetAlerts(context.Background()); err != nil {
		t.Fatalf("GetAlerts() error: %v", err)
	}
	if apiCallCount != 2 {
		t.Errorf("api called %d times, want 2 (initial + retry)", apiCallCount)
	}
	if !strings.Contains(lastAuth, "fresh-tok") {
		t.Errorf("retry used token %q, want fresh-tok", lastAuth)
	}
}

func TestNewClientWithAuth_OAuth2TakesPriority(t *testing.T) {
	tokenSrv, _ := newTokenServer(t, "oauth2-tok", 300, http.StatusOK)
	defer tokenSrv.Close()

	var capturedAuth string
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("[]")) //nolint:errcheck
	}))
	defer apiSrv.Close()

	// OAuth2 + static BearerToken both set — OAuth2 must win.
	client := NewClientWithAuth(apiSrv.URL, Auth{
		BearerToken: "static-tok",
		OAuth2: &OAuth2ClientConfig{
			ClientID: "cid", ClientSecret: "csec", TokenURL: tokenSrv.URL,
		},
	})
	if _, err := client.GetAlerts(context.Background()); err != nil {
		t.Fatalf("GetAlerts() error: %v", err)
	}
	if capturedAuth != "Bearer oauth2-tok" {
		t.Errorf("Authorization = %q, want Bearer oauth2-tok (OAuth2 should win)", capturedAuth)
	}
}
