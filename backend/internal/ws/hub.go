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
	// A queued alerts_update keeps its own copy of the whole alert list
	// reachable, so several of them per client is a real memory hold, not just
	// backpressure (P4, tmp/memory.md §8.2). The bound for them is therefore
	// one: a newer snapshot supersedes the queued one and replaces it in place
	// (Client.enqueue), so the memory ceiling is lower than the old queue of
	// clientBuffer snapshots while nothing is lost — the client is guaranteed
	// the newest list, which is all a snapshot promises.
	//
	// Discrete events (claim_set, comment_added, …) are deltas, not snapshots:
	// merging or dropping one leaves that tab wrong until the next poll, so
	// they are queued individually. They are small — a fingerprint, a cluster
	// name, a claimant — so the bound that matters for them is "deep enough
	// that a burst of real incident activity fits", not a byte budget.
	// Snapshots need no count: at most one is ever pending per client, held in
	// a single slot that a newer one overwrites.
	discreteBuffer        = 32
	globalBroadcastBuffer = 16
)

// outbound is one encoded envelope on its way to the clients, tagged with
// whether it is an alerts_update snapshot (which supersedes a pending one)
// rather than a discrete event (which must not be merged away).
type outbound struct {
	envelope []byte
	snapshot bool
}

// Hub manages all active WebSocket connections.
type Hub struct {
	mu         sync.RWMutex
	clients    map[*Client]struct{}
	broadcast  chan outbound
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
		broadcast:  make(chan outbound, globalBroadcastBuffer),
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
				client.closeSend()
			}
			h.mu.Unlock()

		case msg := <-h.broadcast:
			var overflowed []*Client
			h.mu.RLock()
			for client := range h.clients {
				if !client.enqueue(msg.envelope, msg.snapshot) {
					overflowed = append(overflowed, client)
				}
			}
			h.mu.RUnlock()
			if len(overflowed) == 0 {
				continue
			}
			// Only a client whose discrete backlog is full lands here, and those
			// are deltas that cannot be merged away — it is genuinely not
			// draining, so disconnect it rather than silently lose events. It
			// reconnects and refetches. Snapshots never reach this path: they
			// coalesce into one slot, so a burst of them no longer costs a
			// healthy client its connection (P4, tmp/memory.md §8.2).
			// readPump's own unregister on the resulting read error is
			// idempotent, as is closeSend.
			h.mu.Lock()
			for _, client := range overflowed {
				if _, ok := h.clients[client]; ok {
					delete(h.clients, client)
					client.closeSend()
				}
			}
			h.mu.Unlock()
			for _, client := range overflowed {
				h.logger.Warn("disconnecting ws client with a full discrete backlog")
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
	h.broadcast <- outbound{envelope: envelope, snapshot: eventType == models.WSTypeAlertsUpdate}
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
	client := newClient(h, conn)
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

	mu sync.Mutex
	// queue holds pending envelopes in broadcast order. At most one of them is
	// an alerts_update snapshot, at snapshotIdx (-1 when none is pending): a
	// newer snapshot overwrites that slot rather than appending, so the client
	// never holds two alert lists and the order relative to discrete events is
	// preserved. discrete counts the non-snapshot entries against discreteBuffer.
	queue       [][]byte
	snapshotIdx int
	discrete    int
	closed      bool
	// signal wakes writePump; buffered(1), so a burst coalesces into one wake-up.
	signal chan struct{}
}

func newClient(h *Hub, conn *websocket.Conn) *Client {
	return &Client{hub: h, conn: conn, snapshotIdx: -1, signal: make(chan struct{}, 1)}
}

// enqueue queues one envelope for this client. It reports false only when the
// client is genuinely not draining — its discrete backlog is full — which is the
// caller's cue to disconnect it. A snapshot never overflows: it replaces any
// pending one.
func (c *Client) enqueue(envelope []byte, isSnapshot bool) bool {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return true
	}
	switch {
	case isSnapshot && c.snapshotIdx >= 0:
		c.queue[c.snapshotIdx] = envelope
	case isSnapshot:
		c.queue = append(c.queue, envelope)
		c.snapshotIdx = len(c.queue) - 1
	case c.discrete >= discreteBuffer:
		c.mu.Unlock()
		return false
	default:
		c.queue = append(c.queue, envelope)
		c.discrete++
	}
	c.mu.Unlock()
	c.wake()
	return true
}

// drain hands writePump everything queued so far and reports whether the client
// has been closed, so the pump can send the close frame after the last message.
func (c *Client) drain() ([][]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	msgs := c.queue
	c.queue = nil
	c.snapshotIdx = -1
	c.discrete = 0
	return msgs, c.closed
}

// closeSend marks the client closed and wakes its pump. Idempotent: both the hub
// loop's unregister case and an overflow disconnect may reach the same client.
func (c *Client) closeSend() {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.closed = true
	c.mu.Unlock()
	c.wake()
}

func (c *Client) wake() {
	select {
	case c.signal <- struct{}{}:
	default:
	}
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
		case <-c.signal:
			messages, closed := c.drain()
			for _, message := range messages {
				_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
				if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
					return
				}
			}
			if closed {
				_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
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
