package ws

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/kj187/jarvis/backend/internal/metrics"
)

func newLimitedHub(t *testing.T, max int) (*Hub, *metrics.Metrics, string) {
	t.Helper()
	m := metrics.New("ws-limit-test")
	hub := NewHub([]string{"http://localhost:5173"}, nil, m)
	hub.SetMaxConnections(max)
	go hub.Run()
	srv := httptest.NewServer(hub.upgraderHandler())
	t.Cleanup(srv.Close)
	return hub, m, "ws" + strings.TrimPrefix(srv.URL, "http")
}

// dial returns the open connection, or the HTTP status and Retry-After header
// the handshake was refused with.
func dial(t *testing.T, url string) (conn *websocket.Conn, status int, retryAfter string, err error) {
	t.Helper()
	conn, resp, err := websocket.DefaultDialer.Dial(url, nil)
	if resp != nil {
		status, retryAfter = resp.StatusCode, resp.Header.Get("Retry-After")
		if resp.Body != nil {
			_ = resp.Body.Close()
		}
	}
	if conn != nil {
		t.Cleanup(func() { _ = conn.Close() })
	}
	return conn, status, retryAfter, err
}

func TestHub_MaxConnections_RejectsTheOneOverTheLimit(t *testing.T) {
	hub, m, url := newLimitedHub(t, 2)

	first, _, _, err := dial(t, url)
	if err != nil {
		t.Fatalf("dial 1: %v", err)
	}
	if _, _, _, err := dial(t, url); err != nil {
		t.Fatalf("dial 2: %v", err)
	}

	_, status, retryAfter, err := dial(t, url)
	if err == nil {
		t.Fatal("connection over the limit was accepted")
	}
	if status != http.StatusServiceUnavailable {
		t.Fatalf("over-limit handshake status = %d, want 503", status)
	}
	if retryAfter == "" {
		t.Error("503 carries no Retry-After header")
	}
	if got := testutil.ToFloat64(m.WSRejectedTotal); got != 1 {
		t.Errorf("jarvis_ws_rejected_total = %v, want 1", got)
	}
	waitForClientCount(t, hub, 2)

	// A freed slot is usable again.
	_ = first.Close()
	waitForClientCount(t, hub, 1)
	if _, _, _, err := dial(t, url); err != nil {
		t.Fatalf("dial after a slot was freed: %v", err)
	}
}

func TestHub_MaxConnections_ZeroMeansUnlimited(t *testing.T) {
	_, m, url := newLimitedHub(t, 0)
	for i := 0; i < 20; i++ {
		if _, _, _, err := dial(t, url); err != nil {
			t.Fatalf("dial %d: %v", i, err)
		}
	}
	if got := testutil.ToFloat64(m.WSRejectedTotal); got != 0 {
		t.Errorf("jarvis_ws_rejected_total = %v, want 0", got)
	}
}

// Concurrent handshakes must not slip past the limit between the check and the
// registration.
func TestHub_MaxConnections_ConcurrentBurstNeverExceedsLimit(t *testing.T) {
	const limit, attempts = 5, 40
	hub, _, url := newLimitedHub(t, limit)

	var accepted atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			conn, resp, err := websocket.DefaultDialer.Dial(url, nil)
			if resp != nil && resp.Body != nil {
				_ = resp.Body.Close()
			}
			if err == nil {
				accepted.Add(1)
				t.Cleanup(func() { _ = conn.Close() })
			}
		}()
	}
	wg.Wait()

	if got := accepted.Load(); got != limit {
		t.Fatalf("accepted %d connections, want exactly %d", got, limit)
	}
	waitForClientCount(t, hub, limit)
}
