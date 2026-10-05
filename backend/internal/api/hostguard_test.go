package api

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kj187/jarvis/backend/internal/config"
)

func hostRequest(t *testing.T, allowed []string, host, path string) int {
	t.Helper()
	e, _ := newTestEchoWithConfig(t, &config.Config{AllowedHosts: allowed})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, path, strings.NewReader(""))
	req.Host = host
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec.Code
}

func TestHostGuard(t *testing.T) {
	allow := []string{"jarvis.corp", "jarvis.internal:8443"}
	for _, tc := range []struct {
		name    string
		allowed []string
		host    string
		path    string
		want    int
	}{
		{"empty list lets any host through", nil, "evil.example", "/health", http.StatusOK},
		{"foreign host is rejected", allow, "evil.example", "/api/v1/status", http.StatusMisdirectedRequest},
		{"listed host passes", allow, "jarvis.corp", "/api/v1/status", http.StatusOK},
		{"match ignores case", allow, "JARVIS.Corp", "/api/v1/status", http.StatusOK},
		{"entry without port matches any port", allow, "jarvis.corp:8080", "/api/v1/status", http.StatusOK},
		{"entry with port requires that port", allow, "jarvis.internal:8443", "/api/v1/status", http.StatusOK},
		{"entry with port rejects another port", allow, "jarvis.internal:9000", "/api/v1/status", http.StatusMisdirectedRequest},
		{"entry with port rejects no port", allow, "jarvis.internal", "/api/v1/status", http.StatusMisdirectedRequest},
		{"suffix trick is rejected", allow, "jarvis.corp.evil.example", "/api/v1/status", http.StatusMisdirectedRequest},
		{"liveness probe by pod IP is exempt", allow, "10.1.2.3:8080", "/health/live", http.StatusOK},
		{"readiness probe by pod IP is exempt", allow, "10.1.2.3:8080", "/health/ready", http.StatusOK},
		{"metrics scrape by pod IP is exempt", allow, "10.1.2.3:8080", "/metrics", http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := hostRequest(t, tc.allowed, tc.host, tc.path); got != tc.want {
				t.Errorf("Host %q on %s: status = %d, want %d", tc.host, tc.path, got, tc.want)
			}
		})
	}
}

func TestClientIPExtractor(t *testing.T) {
	_, proxyNet, _ := net.ParseCIDR("10.0.0.0/8")
	for _, tc := range []struct {
		name       string
		trusted    []*net.IPNet
		remoteAddr string
		headers    map[string]string
		want       string
	}{
		{"untrusted peer cannot forge X-Forwarded-For", nil, "203.0.113.9:4000", map[string]string{"X-Forwarded-For": "1.2.3.4"}, "203.0.113.9"},
		{"untrusted peer cannot forge X-Real-IP", nil, "203.0.113.9:4000", map[string]string{"X-Real-IP": "1.2.3.4"}, "203.0.113.9"},
		{"private peer is not trusted by default", nil, "10.0.0.5:4000", map[string]string{"X-Forwarded-For": "1.2.3.4"}, "10.0.0.5"},
		{"peer outside the trusted range cannot forge", []*net.IPNet{proxyNet}, "203.0.113.9:4000", map[string]string{"X-Forwarded-For": "1.2.3.4"}, "203.0.113.9"},
		{"trusted proxy: client from X-Forwarded-For", []*net.IPNet{proxyNet}, "10.0.0.5:4000", map[string]string{"X-Forwarded-For": "198.51.100.7"}, "198.51.100.7"},
		{"trusted proxy: forged left entry is ignored", []*net.IPNet{proxyNet}, "10.0.0.5:4000", map[string]string{"X-Forwarded-For": "1.2.3.4, 198.51.100.7"}, "198.51.100.7"},
		{"trusted proxy chain is skipped", []*net.IPNet{proxyNet}, "10.0.0.5:4000", map[string]string{"X-Forwarded-For": "198.51.100.7, 10.0.0.9"}, "198.51.100.7"},
		{"trusted proxy without header yields the peer", []*net.IPNet{proxyNet}, "10.0.0.5:4000", nil, "10.0.0.5"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e, _ := newTestEchoWithConfig(t, &config.Config{TrustedProxies: tc.trusted})
			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/health", strings.NewReader(""))
			req.RemoteAddr = tc.remoteAddr
			for k, v := range tc.headers {
				req.Header.Set(k, v)
			}
			if got := e.IPExtractor(req); got != tc.want {
				t.Errorf("client IP = %q, want %q", got, tc.want)
			}
		})
	}
}
