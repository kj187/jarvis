package ws

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"

	"github.com/kj187/jarvis/backend/internal/metrics"
)

// dialWithOrigin opens a WebSocket against the hub with the given Origin
// header (none when empty) and returns the HTTP status of the handshake: 101
// when accepted, 403 when the origin check rejected it.
func dialWithOrigin(t *testing.T, allowed []string, origin string, sameOriginHost bool) int {
	t.Helper()
	hub := NewHub(allowed, nil, metrics.New("ws-origin-test"))
	go hub.Run()
	srv := httptest.NewServer(hub.upgraderHandler())
	t.Cleanup(srv.Close)

	header := http.Header{}
	switch {
	case sameOriginHost:
		header.Set("Origin", srv.URL) // http://127.0.0.1:port == "http://"+r.Host
	case origin != "":
		header.Set("Origin", origin)
	}
	conn, resp, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), header)
	if conn != nil {
		_ = conn.Close()
	}
	if resp == nil {
		t.Fatalf("dial: no response (%v)", err)
	}
	if resp.Body != nil {
		_ = resp.Body.Close()
	}
	return resp.StatusCode
}

// The Origin check is the CSRF defence of the WebSocket upgrade (Critical
// Invariant #11): a browser page on another origin must not be able to open
// the stream with the user's cookie.
func TestHub_CheckOrigin(t *testing.T) {
	allowlist := []string{"http://localhost:5173", "https://jarvis.example.com"}

	cases := []struct {
		name           string
		allowed        []string
		origin         string
		sameOriginHost bool
		want           int
	}{
		{"allowlist: listed origin is accepted", allowlist, "https://jarvis.example.com", false, http.StatusSwitchingProtocols},
		{"allowlist: unlisted origin is rejected", allowlist, "https://evil.example", false, http.StatusForbidden},
		{"allowlist: the request's own host is rejected unless listed", allowlist, "", true, http.StatusForbidden},
		{"allowlist: no Origin header (non-browser client) is accepted", allowlist, "", false, http.StatusSwitchingProtocols},
		{"no allowlist: same origin is accepted", nil, "", true, http.StatusSwitchingProtocols},
		{"no allowlist: foreign origin is rejected", nil, "https://evil.example", false, http.StatusForbidden},
		{"no allowlist: no Origin header is accepted", nil, "", false, http.StatusSwitchingProtocols},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := dialWithOrigin(t, tc.allowed, tc.origin, tc.sameOriginHost); got != tc.want {
				t.Errorf("upgrade status = %d, want %d", got, tc.want)
			}
		})
	}
}
