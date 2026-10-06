package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"

	"github.com/kj187/jarvis/backend/internal/metrics"
	"github.com/kj187/jarvis/backend/internal/ws"
)

// The HTTP write guard and the WebSocket upgrade must give the same verdict for
// the same Origin and allow-list (Critical Invariant #11): a deployment that can
// write from a host must also receive the live stream there.
func TestOriginVerdict_HTTPAndWebSocketAgree(t *testing.T) {
	list := []string{"https://jarvis.example.com"}
	cases := []struct {
		name    string
		allowed []string
		origin  string // "OWN" = the server's own http origin, "OWNFTP" the same host over ftp://; "" = no header
		want    bool
	}{
		{"list: listed origin", list, "https://jarvis.example.com", true},
		{"list: foreign origin", list, "https://evil.example", false},
		{"list: own host", list, "OWN", true},
		{"list: no Origin", list, "", true},
		{"empty list: own host", nil, "OWN", true},
		{"empty list: foreign origin", nil, "https://evil.example", false},
		{"empty list: no Origin", nil, "", true},
		{"list: own host over a non-http scheme", list, "OWNFTP", false},
		{"empty list: own host over a non-http scheme", nil, "OWNFTP", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			hub := ws.NewHub(tc.allowed, nil, metrics.New("origin-parity"))
			wsSrv := httptest.NewServer(http.HandlerFunc(hub.ServeWS))
			t.Cleanup(wsSrv.Close)

			e := echo.New()
			e.Use(originGuard(tc.allowed))
			e.POST("/", func(c echo.Context) error { return c.NoContent(http.StatusNoContent) })
			httpSrv := httptest.NewServer(e)
			t.Cleanup(httpSrv.Close)

			origin := func(srv *httptest.Server) string {
				switch tc.origin {
				case "OWN":
					return srv.URL
				case "OWNFTP":
					return "ftp" + strings.TrimPrefix(srv.URL, "http")
				}
				return tc.origin
			}

			h := http.Header{}
			if o := origin(wsSrv); o != "" {
				h.Set("Origin", o)
			}
			conn, resp, _ := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(wsSrv.URL, "http"), h)
			if conn != nil {
				_ = conn.Close()
			}
			wsOK := resp != nil && resp.StatusCode == http.StatusSwitchingProtocols
			if resp != nil && resp.Body != nil {
				_ = resp.Body.Close()
			}

			req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, httpSrv.URL, nil)
			if o := origin(httpSrv); o != "" {
				req.Header.Set("Origin", o)
			}
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			_ = res.Body.Close()
			httpOK := res.StatusCode == http.StatusNoContent

			if wsOK != tc.want || httpOK != tc.want {
				t.Errorf("websocket accepted=%v, http write accepted=%v, want both %v", wsOK, httpOK, tc.want)
			}
		})
	}
}
