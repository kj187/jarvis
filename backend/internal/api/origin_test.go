package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// originRequest drives the full router; httptest.NewRequest gives Host "example.com".
func originRequest(t *testing.T, origins []string, method, path string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	e, _ := newTestEchoWithDB(t, origins)
	req := httptest.NewRequestWithContext(context.Background(), method, path, strings.NewReader(""))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func TestOriginGuard(t *testing.T) {
	allow := []string{"https://jarvis.corp"}
	for _, tc := range []struct {
		name    string
		origins []string
		method  string
		headers map[string]string
		want    int
	}{
		{"foreign origin is rejected", nil, http.MethodPost, map[string]string{"Origin": "https://evil.example"}, http.StatusForbidden},
		{"null origin is rejected", nil, http.MethodPost, map[string]string{"Origin": "null"}, http.StatusForbidden},
		{"foreign origin on DELETE is rejected", nil, http.MethodDelete, map[string]string{"Origin": "https://evil.example"}, http.StatusForbidden},
		{"foreign origin not on the allow-list is rejected", allow, http.MethodPost, map[string]string{"Origin": "https://evil.example"}, http.StatusForbidden},
		{"same origin passes", nil, http.MethodPost, map[string]string{"Origin": "http://example.com"}, http.StatusNoContent},
		{"same host behind a TLS proxy passes", nil, http.MethodPost, map[string]string{"Origin": "https://example.com"}, http.StatusNoContent},
		{"allow-listed origin passes", allow, http.MethodPost, map[string]string{"Origin": "https://jarvis.corp"}, http.StatusNoContent},
		{"no Origin and no fetch metadata (non-browser client) passes", nil, http.MethodPost, nil, http.StatusNoContent},
		{"no Origin but Sec-Fetch-Site cross-site is rejected", nil, http.MethodPost, map[string]string{"Sec-Fetch-Site": "cross-site"}, http.StatusForbidden},
		{"Sec-Fetch-Site same-origin passes", nil, http.MethodPost, map[string]string{"Sec-Fetch-Site": "same-origin"}, http.StatusNoContent},
		{"safe method with a foreign origin is not guarded", nil, http.MethodGet, map[string]string{"Origin": "https://evil.example"}, http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := "/api/v1/poll"
			if tc.method == http.MethodGet {
				path = "/health"
			}
			if tc.method == http.MethodDelete {
				path = "/api/v1/alerts/abc/comments/1"
			}
			rec := originRequest(t, tc.origins, tc.method, path, tc.headers)
			if tc.want == http.StatusForbidden {
				if rec.Code != http.StatusForbidden {
					t.Fatalf("status = %d, want 403: %s", rec.Code, rec.Body.String())
				}
				return
			}
			if rec.Code == http.StatusForbidden {
				t.Fatalf("status = 403, want the request to reach the handler: %s", rec.Body.String())
			}
			if tc.method == http.MethodPost && rec.Code != tc.want {
				t.Fatalf("status = %d, want %d", rec.Code, tc.want)
			}
		})
	}
}

func TestSecurityHeaders(t *testing.T) {
	rec := originRequest(t, nil, http.MethodGet, "/health", nil)
	h := rec.Header()

	csp := h.Get("Content-Security-Policy")
	for _, want := range []string{"frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'", "default-src 'self'"} {
		if !strings.Contains(csp, want) {
			t.Errorf("CSP %q lacks %q", csp, want)
		}
	}
	if got := h.Get("X-Frame-Options"); got != "DENY" {
		t.Errorf("X-Frame-Options = %q, want DENY", got)
	}
	if got := h.Get("Referrer-Policy"); got != "same-origin" {
		t.Errorf("Referrer-Policy = %q, want same-origin", got)
	}
	if got := h.Get("Permissions-Policy"); !strings.Contains(got, "camera=()") {
		t.Errorf("Permissions-Policy = %q, want camera=() among the denied features", got)
	}
	if got := h.Get("X-Xss-Protection"); got != "" {
		t.Errorf("X-XSS-Protection = %q, want it dropped (obsolete, can introduce XSS in old browsers)", got)
	}
	if got := h.Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
	}
}
