package ws

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func dialIdentified(t *testing.T, hub *Hub, id *Identity) (*websocket.Conn, func()) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.ServeWSFor(w, r, id)
	}))
	before := hub.ClientCount()
	conn, resp, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		srv.Close()
		t.Fatalf("dial ws: %v", err)
	}
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	// Dial returns once the 101 is on the wire; the hub registers the client a
	// moment later, so wait for it before the test acts on the hub.
	waitForClientCount(t, hub, before+1)
	return conn, func() { _ = conn.Close(); srv.Close() }
}

func waitClosed(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			if ne, ok := err.(interface{ Timeout() bool }); ok && ne.Timeout() {
				t.Fatal("connection still open")
			}
			return
		}
	}
}

func TestHub_CloseUserClosesOnlyThatUsersClients(t *testing.T) {
	hub := newTestHub(t)
	victim, closeVictim := dialIdentified(t, hub, &Identity{UserID: "u1"})
	defer closeVictim()
	other, closeOther := dialIdentified(t, hub, &Identity{UserID: "u2"})
	defer closeOther()
	anon, closeAnon := dialIdentified(t, hub, nil)
	defer closeAnon()

	hub.CloseUser("u1")
	waitClosed(t, victim)

	hub.BroadcastJSON("still_alive", nil)
	for name, c := range map[string]*websocket.Conn{"other user": other, "anonymous": anon} {
		_ = c.SetReadDeadline(time.Now().Add(time.Second))
		_, msg, err := c.ReadMessage()
		if err != nil || !strings.Contains(string(msg), "still_alive") {
			t.Fatalf("%s must stay connected and receive broadcasts: %q %v", name, msg, err)
		}
	}
}

func TestHub_PeriodicSessionCheckClosesRevokedClients(t *testing.T) {
	hub := newTestHub(t)
	hub.pingPeriod = 30 * time.Millisecond
	var revoked atomic.Bool
	hub.SetSessionCheck(func(userID string, tokenVersion int) bool {
		return !revoked.Load() || userID != "u1" || tokenVersion != 3
	})

	conn, cleanup := dialIdentified(t, hub, &Identity{UserID: "u1", TokenVersion: 3})
	defer cleanup()
	anon, cleanupAnon := dialIdentified(t, hub, nil)
	defer cleanupAnon()

	time.Sleep(100 * time.Millisecond) // several ticks with a valid session
	if hub.ClientCount() != 2 {
		t.Fatalf("ClientCount = %d, want 2 while the session is valid", hub.ClientCount())
	}
	revoked.Store(true)
	waitClosed(t, conn)

	// The anonymous client has no session to lose.
	_ = anon.SetReadDeadline(time.Now().Add(150 * time.Millisecond))
	for {
		if _, _, err := anon.ReadMessage(); err != nil {
			if ne, ok := err.(interface{ Timeout() bool }); !ok || !ne.Timeout() {
				t.Fatalf("anonymous client was closed: %v", err)
			}
			break
		}
	}
}
