package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

// publicWriteRoutes are the only mutating routes that must answer without a
// session. Anything else that writes is gated by requireAuth / RequireAdmin;
// adding a new write route without a gate fails the test below.
var publicWriteRoutes = map[string]string{
	"POST /setup":      "first-run wizard; guarded by 'no user exists' and the optional setup token",
	"POST /auth/login": "obtains the session itself",
}

var routeParam = regexp.MustCompile(`:[A-Za-z]+`)

// Every registered mutating route refuses an anonymous caller in both modes
// that have a login (write_protect, full_protect). Walking e.Routes() rather
// than a hand-written list means a newly added write route is covered the
// moment it is registered, and removing requireAuth from any one of them is
// caught.
func TestRouter_EveryWriteRouteRequiresASession(t *testing.T) {
	for _, mode := range []string{"write_protect", "full_protect"} {
		t.Run(mode, func(t *testing.T) {
			e := newTestEchoInternal(t, mode)

			checked := 0
			for _, r := range e.Routes() {
				switch r.Method {
				case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
				default:
					continue
				}
				key := r.Method + " " + r.Path
				if _, ok := publicWriteRoutes[key]; ok {
					continue
				}
				if strings.HasPrefix(r.Path, "/api/v1/test/") {
					continue // E2E-only helper routes, not registered in production builds
				}

				path := routeParam.ReplaceAllString(r.Path, "x")
				req := httptest.NewRequestWithContext(context.Background(), r.Method, path, strings.NewReader("{}"))
				req.Header.Set("Content-Type", "application/json")
				rec := httptest.NewRecorder()
				e.ServeHTTP(rec, req)

				if rec.Code != http.StatusUnauthorized {
					t.Errorf("%s without a session = %d, want 401", key, rec.Code)
				}
				checked++
			}
			if checked < 15 {
				t.Fatalf("only %d write routes checked — the route walk is not seeing the router", checked)
			}
		})
	}
}
