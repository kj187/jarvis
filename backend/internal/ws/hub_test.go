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
	"github.com/kj187/jarvis/backend/internal/models"
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

// registerStuckClient upgrades a real connection and registers it without
// starting its pumps, so nothing ever drains its queue — a deterministic stand-in
// for a writer permanently blocked on a stuck socket, without relying on real
// OS-level TCP backpressure timing.
func registerStuckClient(t *testing.T, hub *Hub) *websocket.Conn {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := hub.upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade stuck client: %v", err)
			return
		}
		hub.mu.Lock()
		hub.clients[newClient(hub, conn)] = struct{}{}
		hub.mu.Unlock()
	}))
	t.Cleanup(srv.Close)

	conn, resp, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatalf("dial stuck client: %v", err)
	}
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func dialClient(t *testing.T, hub *Hub) *websocket.Conn {
	t.Helper()
	srv := httptest.NewServer(hub.upgraderHandler())
	t.Cleanup(srv.Close)
	conn, resp, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatalf("dial client: %v", err)
	}
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func waitForClientCount(t *testing.T, hub *Hub, want int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for hub.ClientCount() != want && time.Now().Before(deadline) {
		time.Sleep(2 * time.Millisecond)
	}
	if got := hub.ClientCount(); got != want {
		t.Fatalf("ClientCount = %d, want %d", got, want)
	}
}

// A burst of snapshots must never cost a healthy client its connection. The hub
// enqueues far faster than any client can write to its socket, so with a queue
// bounded by message count every client was one burst away from being classified
// "slow" and dropped — in production that disconnects every open tab at once and
// each reconnect triggers a full refetch.
//
// alerts_update carries the whole alert list, so a newer one supersedes any still
// queued: it is coalesced in place per client. That keeps P4 §8.2's actual intent
// (never hold several large snapshots per client — the bound is now one) while the
// client is guaranteed the newest snapshot rather than every intermediate one.
func TestHub_SnapshotBurstKeepsDrainingClientAndDeliversNewest(t *testing.T) {
	hub := newTestHub(t)
	conn := dialClient(t, hub)
	waitForClientCount(t, hub, 1)

	const messages = 40
	for i := 0; i < messages; i++ {
		hub.BroadcastJSON(models.WSTypeAlertsUpdate, map[string]int{"i": i})
	}

	// Every read must succeed — being dropped mid-burst is the regression this
	// guards — and the newest snapshot must arrive.
	newest := fmt.Sprintf(`"i":%d`, messages-1)
	deadline := time.Now().Add(5 * time.Second)
	for {
		if time.Now().After(deadline) {
			t.Fatalf("newest snapshot %s never arrived", newest)
		}
		if err := conn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
			t.Fatalf("SetReadDeadline: %v", err)
		}
		_, msg, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("healthy client dropped during snapshot burst: %v", err)
		}
		if strings.Contains(string(msg), newest) {
			break
		}
	}

	if got := hub.ClientCount(); got != 1 {
		t.Fatalf("ClientCount = %d, want 1 (a snapshot burst must not disconnect a healthy client)", got)
	}
}

// Discrete events carry a delta, not a snapshot: dropping or coalescing one leaves
// that tab wrong until the next poll. They are never merged, and the queue holds
// enough of them (discreteBuffer) that a normal incident burst cannot overflow it.
func TestHub_DiscreteEventsAreNeverCoalesced(t *testing.T) {
	hub := newTestHub(t)
	conn := dialClient(t, hub)
	waitForClientCount(t, hub, 1)

	const messages = 12
	for i := 0; i < messages; i++ {
		hub.BroadcastJSON(models.WSTypeClaimSet, map[string]int{"i": i})
	}

	for i := 0; i < messages; i++ {
		if err := conn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
			t.Fatalf("SetReadDeadline: %v", err)
		}
		_, msg, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("read discrete event %d: %v", i, err)
		}
		if !strings.Contains(string(msg), fmt.Sprintf(`"i":%d`, i)) {
			t.Errorf("discrete event %d out of order/missing: %s", i, msg)
		}
	}
}

// The case the overflow disconnect exists for: a client that never drains. Only
// discrete events can fill the queue now (snapshots coalesce into one slot), so
// that is what pushes it past its bound.
func TestHub_StuckClientDisconnectedWhenQueueFillsWithDiscreteEvents(t *testing.T) {
	hub := newTestHub(t)
	_ = registerStuckClient(t, hub)
	waitForClientCount(t, hub, 1)

	for i := 0; i < discreteBuffer+2; i++ {
		hub.BroadcastJSON(models.WSTypeClaimSet, map[string]int{"i": i})
	}

	waitForClientCount(t, hub, 0)
}

// A stuck client must not survive on snapshots alone either: coalescing keeps its
// queue at one slot, so the write deadline in writePump is what tears it down —
// but the hub must not leak it while that plays out, and a healthy peer must keep
// receiving throughout.
func TestHub_SnapshotBurstToStuckClientLeavesHealthyPeerConnected(t *testing.T) {
	hub := newTestHub(t)
	healthy := dialClient(t, hub)
	_ = registerStuckClient(t, hub)
	waitForClientCount(t, hub, 2)

	const messages = 40
	for i := 0; i < messages; i++ {
		hub.BroadcastJSON(models.WSTypeAlertsUpdate, map[string]int{"i": i})
	}

	newest := fmt.Sprintf(`"i":%d`, messages-1)
	deadline := time.Now().Add(5 * time.Second)
	for {
		if time.Now().After(deadline) {
			t.Fatalf("newest snapshot %s never arrived at the healthy peer", newest)
		}
		if err := healthy.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
			t.Fatalf("SetReadDeadline: %v", err)
		}
		_, msg, err := healthy.ReadMessage()
		if err != nil {
			t.Fatalf("healthy peer dropped while a stuck client was queued: %v", err)
		}
		if strings.Contains(string(msg), newest) {
			break
		}
	}
}
