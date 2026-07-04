package ws

import (
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/kj187/jarvis/backend/internal/metrics"
)

func newTestHub(t *testing.T) *Hub {
	t.Helper()
	hub := NewHub([]string{"http://localhost:5173"}, slog.Default(), nil)
	go hub.Run()
	return hub
}

func TestHub_BroadcastToClients(t *testing.T) {
	hub := newTestHub(t)

	srv := httptest.NewServer(hub.upgraderHandler())
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial ws: %v", err)
	}
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	defer func() { _ = conn.Close() }()

	// Give the hub time to register the client.
	time.Sleep(50 * time.Millisecond)

	if hub.ClientCount() != 1 {
		t.Errorf("ClientCount = %d, want 1", hub.ClientCount())
	}

	hub.BroadcastJSON("test_event", map[string]string{"key": "value"})

	if err := conn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}
	_, msg, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read message: %v", err)
	}
	if !strings.Contains(string(msg), "test_event") {
		t.Errorf("message does not contain event type: %s", msg)
	}
}

// Registration must complete inside ServeWS, independent of the hub event
// loop. If it goes through the loop, a broadcast racing the registration can
// be delivered to an empty client set and the event is lost — the browser
// already sees the socket as open (101 handshake) before the loop runs.
// Regression test for the flaky J3 e2e case (claim_set arriving right after
// connect). The hub loop is intentionally NOT started here.
func TestHub_ServeWSRegistersSynchronously(t *testing.T) {
	hub := NewHub([]string{"http://localhost:5173"}, slog.Default(), nil) // no hub.Run()

	srv := httptest.NewServer(hub.upgraderHandler())
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial ws: %v", err)
	}
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	defer func() { _ = conn.Close() }()

	// Allow the server goroutine to finish ServeWS, but never the (stopped)
	// hub loop — asynchronous registration keeps the count at 0 forever.
	deadline := time.Now().Add(2 * time.Second)
	for hub.ClientCount() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if got := hub.ClientCount(); got != 1 {
		t.Errorf("ClientCount = %d, want 1 (registration must not depend on the hub loop)", got)
	}
}

func TestHub_ClientCountAfterDisconnect(t *testing.T) {
	hub := newTestHub(t)

	srv := httptest.NewServer(hub.upgraderHandler())
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial ws: %v", err)
	}
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}

	time.Sleep(50 * time.Millisecond)
	if hub.ClientCount() != 1 {
		t.Errorf("ClientCount = %d, want 1", hub.ClientCount())
	}

	_ = conn.Close()
	time.Sleep(100 * time.Millisecond)

	if hub.ClientCount() != 0 {
		t.Errorf("ClientCount = %d, want 0 after disconnect", hub.ClientCount())
	}
}

func TestHub_BroadcastJSON_IncrementsMetric(t *testing.T) {
	m := metrics.New("test")
	hub := NewHub(nil, slog.Default(), m)
	go hub.Run()

	hub.BroadcastJSON("alerts_update", map[string]string{"k": "v"})
	hub.BroadcastJSON("alerts_update", map[string]string{"k": "v"})
	hub.BroadcastJSON("comment_added", map[string]string{"k": "v"})

	if got := testutil.ToFloat64(m.WSBroadcastsTotal.WithLabelValues("alerts_update")); got != 2 {
		t.Errorf("alerts_update broadcasts = %v, want 2", got)
	}
	if got := testutil.ToFloat64(m.WSBroadcastsTotal.WithLabelValues("comment_added")); got != 1 {
		t.Errorf("comment_added broadcasts = %v, want 1", got)
	}
}
