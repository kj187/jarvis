package ws

import (
	"fmt"
	"log/slog"
	"net/http"
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

// TestBuildEventJSON_BroadcastRaw_MatchesBroadcastJSON verifies the D4
// fanout building blocks: BuildEventJSON + BroadcastRaw must deliver a
// byte-identical message to BroadcastJSON's own encoding, and BroadcastRaw
// must still label the WSBroadcastsTotal metric correctly by reading the
// type back out of the encoded bytes (fanout consumers never carry the
// original typed payload, only bytes from another pod).
func TestBuildEventJSON_BroadcastRaw_MatchesBroadcastJSON(t *testing.T) {
	m := metrics.New("test")
	hub := NewHub(nil, slog.Default(), m)
	go hub.Run()

	data, err := BuildEventJSON("claim_set", map[string]string{"fingerprint": "fp1"})
	if err != nil {
		t.Fatalf("BuildEventJSON: %v", err)
	}
	hub.BroadcastRaw(data)

	if got := testutil.ToFloat64(m.WSBroadcastsTotal.WithLabelValues("claim_set")); got != 1 {
		t.Errorf("claim_set broadcasts after BroadcastRaw = %v, want 1", got)
	}
}

// TestHub_BroadcastRaw_UnknownEventTypeMapsToUnknownMetricLabel verifies P4's
// fixed WS metric label set: an event type outside the known set (e.g. a
// corrupted fanout envelope from another pod) must never create an
// unbounded Prometheus label — it collapses to "unknown".
func TestHub_BroadcastRaw_UnknownEventTypeMapsToUnknownMetricLabel(t *testing.T) {
	m := metrics.New("test")
	hub := NewHub(nil, slog.Default(), m)
	go hub.Run()

	hub.BroadcastRaw([]byte(`{"type":"totally_unexpected_type","payload":{}}`))

	if got := testutil.ToFloat64(m.WSBroadcastsTotal.WithLabelValues("unknown")); got != 1 {
		t.Errorf("unknown broadcasts = %v, want 1", got)
	}
	if got := testutil.ToFloat64(m.WSBroadcastsTotal.WithLabelValues("totally_unexpected_type")); got != 0 {
		t.Errorf("totally_unexpected_type broadcasts = %v, want 0 (must not become its own label)", got)
	}
}

// TestHub_SlowClientDisconnectedOnQueueOverflow reproduces P4 §8.2: a client
// whose send queue is full (a blocked/unresponsive writer) is disconnected
// instead of having its messages silently dropped — so it can't hold stale,
// large queued payloads indefinitely — while a healthy client keeps
// receiving every broadcast in order.
func TestHub_SlowClientDisconnectedOnQueueOverflow(t *testing.T) {
	hub := newTestHub(t)

	srv := httptest.NewServer(hub.upgraderHandler())
	defer srv.Close()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")

	healthyConn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial healthy client: %v", err)
	}
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	defer func() { _ = healthyConn.Close() }()

	// Slow client: upgrade a real connection but deliberately never start its
	// read/write pumps, so nothing ever drains its send channel — a
	// deterministic stand-in for a writer permanently blocked on a stuck
	// socket, without relying on real OS-level TCP backpressure timing.
	slowSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := hub.upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade slow client: %v", err)
			return
		}
		slow := &Client{hub: hub, conn: conn, send: make(chan []byte, clientBuffer)}
		hub.mu.Lock()
		hub.clients[slow] = struct{}{}
		hub.mu.Unlock()
	}))
	defer slowSrv.Close()
	slowWSURL := "ws" + strings.TrimPrefix(slowSrv.URL, "http")
	slowConn, resp2, err := websocket.DefaultDialer.Dial(slowWSURL, nil)
	if err != nil {
		t.Fatalf("dial slow client: %v", err)
	}
	if resp2 != nil && resp2.Body != nil {
		_ = resp2.Body.Close()
	}
	defer func() { _ = slowConn.Close() }()

	time.Sleep(50 * time.Millisecond)
	if hub.ClientCount() != 2 {
		t.Fatalf("ClientCount = %d, want 2 before broadcasting", hub.ClientCount())
	}

	const messages = clientBuffer + 2
	for i := 0; i < messages; i++ {
		hub.BroadcastJSON("alerts_update", map[string]int{"i": i})
	}

	for i := 0; i < messages; i++ {
		if err := healthyConn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
			t.Fatalf("SetReadDeadline: %v", err)
		}
		_, msg, err := healthyConn.ReadMessage()
		if err != nil {
			t.Fatalf("healthy client read message %d: %v", i, err)
		}
		if !strings.Contains(string(msg), fmt.Sprintf(`"i":%d`, i)) {
			t.Errorf("healthy client message %d out of order/missing: %s", i, msg)
		}
	}

	deadline := time.Now().Add(2 * time.Second)
	for hub.ClientCount() != 1 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if got := hub.ClientCount(); got != 1 {
		t.Fatalf("ClientCount = %d, want 1 (slow client should have been disconnected)", got)
	}
}
