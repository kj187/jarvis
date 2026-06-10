package ws

import (
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func newTestHub(t *testing.T) *Hub {
	t.Helper()
	hub := NewHub([]string{"http://localhost:5173"}, slog.Default())
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
