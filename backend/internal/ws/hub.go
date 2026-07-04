package ws

import (
	"encoding/json"
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
	clientBuffer   = 64
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

// NewHub creates a new Hub.
func NewHub(allowedOrigins []string, logger *slog.Logger, m *metrics.Metrics) *Hub {
	originSet := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		originSet[o] = struct{}{}
	}

	h := &Hub{
		clients:    make(map[*Client]struct{}),
		broadcast:  make(chan []byte, 256),
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
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					// Slow client — drop message.
					h.logger.Warn("dropping message for slow client")
				}
			}
			h.mu.RUnlock()
		}
	}
}

// BroadcastJSON encodes a typed WS event and queues it for broadcast.
func (h *Hub) BroadcastJSON(eventType string, payload interface{}) {
	p, err := json.Marshal(payload)
	if err != nil {
		h.logger.Error("marshal ws payload", "err", err)
		return
	}
	event := models.WSEvent{Type: eventType, Payload: p}
	data, err := json.Marshal(event)
	if err != nil {
		h.logger.Error("marshal ws event", "err", err)
		return
	}
	if h.metrics != nil {
		h.metrics.WSBroadcastsTotal.WithLabelValues(eventType).Inc()
	}
	h.broadcast <- data
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
