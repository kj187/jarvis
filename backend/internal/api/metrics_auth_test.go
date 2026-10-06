package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kj187/jarvis/backend/internal/config"
)

func TestMetricsToken(t *testing.T) {
	for _, tc := range []struct {
		name   string
		token  string
		header string
		want   int
	}{
		{"no token configured: open", "", "", http.StatusOK},
		{"token configured, no header", "scrape-me", "", http.StatusUnauthorized},
		{"token configured, wrong token", "scrape-me", "Bearer nope", http.StatusUnauthorized},
		{"token configured, wrong scheme", "scrape-me", "Basic scrape-me", http.StatusUnauthorized},
		{"token configured, longer token with same prefix", "scrape-me", "Bearer scrape-me-and-more", http.StatusUnauthorized},
		{"token configured, right token", "scrape-me", "Bearer scrape-me", http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e, _ := newTestEchoWithConfig(t, &config.Config{MetricsToken: tc.token})
			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/metrics", nil)
			if tc.header != "" {
				req.Header.Set("Authorization", tc.header)
			}
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Errorf("status = %d, want %d", rec.Code, tc.want)
			}
			if tc.want == http.StatusUnauthorized && rec.Header().Get("WWW-Authenticate") == "" {
				t.Error("401 without WWW-Authenticate challenge")
			}
		})
	}
}

func TestMetricsToken_OtherRoutesUnaffected(t *testing.T) {
	e, _ := newTestEchoWithConfig(t, &config.Config{MetricsToken: "scrape-me"})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("/health status = %d, want 200", rec.Code)
	}
}
