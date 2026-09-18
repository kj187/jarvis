package ws

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/kj187/jarvis/backend/internal/metrics"
	"github.com/kj187/jarvis/backend/internal/models"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = 54 * time.Second
	maxMessageSize = 512 * 1024 // 512 KB
	// clientBuffer/globalBroadcastBuffer are message counts, not a byte
	// budget: different queued alerts_update versions each keep their own
	// backing array reachable, so a deep queue of large snapshots is a real
	// memory hold, not just backpressure (P4, tmp/memory.md §8.2).
	clientBuffer          = 4
	globalBroadcastBuffer = 16
)

// Hub manages all active WebSocket connections.
type Hub struct {
	mu         sync.RWMutex
	clients    map[*Client]struct{}
	broadcast  chan []byte
	unregister chan *Client
	logger     *slog.Logger
	upgrader   websocket.Upgrader
	metrics    *metrics.Metrics
}

// NewHub creates a new Hub. A nil logger is replaced with a no-op logger so
// callers (tests) that don't care about hub logs can pass nil safely.
func NewHub(allowedOrigins []string, logger *slog.Logger, m *metrics.Metrics) *Hub {
	if logger == nil {
		logger = slog.New(slog.DiscardHandler)
	}
	originSet := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		originSet[o] = struct{}{}
	}

	h := &Hub{
		clients:    make(map[*Client]struct{}),
		broadcast:  make(chan []byte, globalBroadcastBuffer),
		unregister: make(chan *Client, 16),
		logger:     logger,
		metrics:    m,
	}
	h.upgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				// No Origin header — non-browser clients cannot trigger CSRF.
				return true
			}
			if len(allowedOrigins) == 0 {
				// Same-origin only.
				return origin == "http://"+r.Host || origin == "https://"+r.Host
			}
			_, ok := originSet[origin]
			return ok
		},
	}
	return h
}

// Run starts the hub event loop. Must be called in a goroutine.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()

		case message := <-h.broadcast:
			var overflowed []*Client
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					overflowed = append(overflowed, client)
				}
			}
			h.mu.RUnlock()
			if len(overflowed) == 0 {
				continue
			}
			// A full client queue means the client is too slow to keep up —
			// disconnect it instead of silently dropping the message, so a
			// stuck client doesn't keep holding stale, large queued payloads
			// (P4, tmp/memory.md §8.2). readPump's own unregister on the
			// resulting read error is idempotent (Run's unregister case checks
			// map membership before closing send again).
			h.mu.Lock()
			for _, client := range overflowed {
				if _, ok := h.clients[client]; ok {
					delete(h.clients, client)
					close(client.send)
				}
			}
			h.mu.Unlock()
			for _, client := range overflowed {
				h.logger.Warn("disconnecting slow ws client")
				_ = client.conn.Close()
			}
		}
	}
}

// BuildEventJSON encodes a typed WS event exactly as BroadcastJSON does,
// without queuing it — callers that also need to fan the same bytes out to
// other pods (D4, docs/postgres-ha.md: internal/fanout) build once
// with this and pass the result to both BroadcastRaw and Fanout.Publish, so
// every pod's clients receive byte-identical messages regardless of which
// pod originated the mutation.
func BuildEventJSON(eventType string, payload interface{}) ([]byte, error) {
	p, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal ws payload: %w", err)
	}
	event := models.WSEvent{Type: eventType, Payload: p}
	data, err := json.Marshal(event)
	if err != nil {
		return nil, fmt.Errorf("marshal ws event: %w", err)
	}
	return data, nil
}

// BroadcastJSON encodes a typed WS event and queues it for broadcast to this
// pod's own clients only — see BroadcastRaw for the cross-pod-fanout case.
func (h *Hub) BroadcastJSON(eventType string, payload interface{}) {
	data, err := BuildEventJSON(eventType, payload)
	if err != nil {
		h.logger.Error("build ws event", "type", eventType, "err", err)
		return
	}
	h.BroadcastTyped(eventType, data)
}

// BroadcastRaw queues an already-encoded WS event (see BuildEventJSON) for
// broadcast to this pod's own clients — used directly by fanout consumers
// that received the bytes from another pod and don't know the event type
// upfront. Only the outer {"type":...} envelope field is decoded for the
// metric label — never the (possibly large) payload, unlike a full
// models.WSEvent unmarshal.
func (h *Hub) BroadcastRaw(data []byte) {
	eventType := "unknown"
	var head struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(data, &head); err == nil {
		eventType = head.Type
	}
	h.BroadcastTyped(eventType, data)
}

// BroadcastTyped queues an already-encoded WS envelope (see BuildEventJSON)
// for broadcast to this pod's own clients, recording the metric under
// eventType without decoding the envelope. eventType is normalized to a
// fixed, known set (metricEventType) before use as a Prometheus label, so an
// unexpected string (e.g. a corrupted fanout envelope) can never create
// unbounded label cardinality.
func (h *Hub) BroadcastTyped(eventType string, envelope []byte) {
	if h.metrics != nil {
		h.metrics.WSBroadcastsTotal.WithLabelValues(metricEventType(eventType)).Inc()
	}
	h.broadcast <- envelope
}

// metricEventType maps eventType to itself if it's one of the known WS event
// types, else to "unknown" — the fixed label set the WSBroadcastsTotal
// metric requires.
func metricEventType(eventType string) string {
	switch eventType {
	case models.WSTypeAlertsUpdate, models.WSTypeClaimSet, models.WSTypeClaimReleased,
		models.WSTypeCommentAdded, models.WSTypeSilencesUpdate:
		return eventType
	default:
		return "unknown"
	}
}

// ServeWS upgrades an HTTP connection to a WebSocket and registers the client.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error("ws upgrade", "err", err)
		return
	}
	client := &Client{hub: h, conn: conn, send: make(chan []byte, clientBuffer)}
	// Register synchronously: the browser considers the socket open as soon as
	// the 101 handshake completes, so a broadcast fired right after connect
	// (e.g. claim_set) must already see this client. Routing registration
	// through the hub loop loses such events — the loop's select gives no
	// ordering guarantee between a pending registration and a broadcast.
	h.mu.Lock()
	h.clients[client] = struct{}{}
	h.mu.Unlock()
	go client.writePump()
	go client.readPump()
}

// ClientCount returns the number of currently connected clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// upgraderHandler returns an http.Handler that upgrades connections. Used in
// tests so we don't need an Echo server.
func (h *Hub) upgraderHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.ServeWS(w, r)
	})
}

// ── Client ────────────────────────────────────────────────────────────────────

// Client represents a single WebSocket connection.
type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
}

// readPump keeps reading from the WebSocket to process pong messages and
// detect disconnections. All incoming messages are ignored.
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		_ = c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMessageSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				c.hub.logger.Debug("ws read error", "err", err)
			}
			break
		}
	}
}

// writePump pumps messages from the send channel to the WebSocket.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
