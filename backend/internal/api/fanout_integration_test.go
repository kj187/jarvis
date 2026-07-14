package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/fanout"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/metrics"
	"github.com/kj187/jarvis/backend/internal/users"
	"github.com/kj187/jarvis/backend/internal/ws"
)

// TestFanout_CommentMutation_ReachesBothPodsExactlyOnce is the D4 integration
// test the multi-replica plan asks for: two full "pods" — each its own
// Store, Hub, and PGFanout — sharing one PostgreSQL database. A mutation
// handled by pod A's HTTP handler must reach pod B's WS clients (converged
// via fanout) exactly once, and pod A's own WS clients exactly once (no
// echo double-delivery from A's own Publish reaching its own Run loop).
func TestFanout_CommentMutation_ReachesBothPodsExactlyOnce(t *testing.T) {
	dsn := os.Getenv("JARVIS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("JARVIS_TEST_POSTGRES_DSN not set — skipping PostgreSQL-backed test")
	}

	setup, dialect, err := idb.Open(dsn)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	if err := idb.Migrate(setup, dialect); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if _, err := setup.ExecContext(context.Background(),
		`TRUNCATE alert_events, alert_fingerprints, alert_claims, alert_comments RESTART IDENTITY CASCADE`,
	); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	if err := setup.Close(); err != nil {
		t.Fatalf("close setup conn: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	podA := newFanoutTestPod(t, dsn, logger)
	podB := newFanoutTestPod(t, dsn, logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go podA.fanout.Run(ctx, HandleFanoutMessage(podA.hub), HandleFanoutRef(podA.store, podA.hub, logger))
	go podB.fanout.Run(ctx, HandleFanoutMessage(podB.hub), HandleFanoutRef(podB.store, podB.hub, logger))
	time.Sleep(300 * time.Millisecond) // let both LISTEN connections establish

	clientA := connectWSClient(t, podA.hub)
	clientB := connectWSClient(t, podB.hub)

	if err := podA.store.UpsertFingerprint("1234567890abcdef", "TestAlert", "c1", map[string]string{"alertname": "TestAlert"}); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}

	// Drive the real HTTP handler on pod A.
	e := echo.New()
	body := strings.NewReader(`{"authorName":"alice","body":"hello from pod A"}`)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/?cluster=c1", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("1234567890abcdef")
	if err := podA.server.addComment(c); err != nil {
		t.Fatalf("addComment: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("addComment status = %d, want 201, body=%s", rec.Code, rec.Body.String())
	}

	msgB := readWSMessage(t, clientB, 5*time.Second)
	assertCommentAddedMessage(t, msgB, "hello from pod A")

	msgA := readWSMessage(t, clientA, 5*time.Second)
	assertCommentAddedMessage(t, msgA, "hello from pod A")

	// Neither client may receive a second copy (no echo double-delivery, no
	// duplicate cross-pod fanout).
	assertNoFurtherMessage(t, clientA, 300*time.Millisecond)
	assertNoFurtherMessage(t, clientB, 300*time.Millisecond)
}

// TestFanout_OversizedComment_UsesRefFallback exercises the D4 reference
// fallback end-to-end: a comment body long enough to push the encoded
// envelope past maxNotifyPayloadBytes must still converge to pod B — not by
// embedding the full message, but via a Ref that pod B resolves by
// refetching the comment from the (shared) database.
func TestFanout_OversizedComment_UsesRefFallback(t *testing.T) {
	dsn := os.Getenv("JARVIS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("JARVIS_TEST_POSTGRES_DSN not set — skipping PostgreSQL-backed test")
	}

	setup, dialect, err := idb.Open(dsn)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	if err := idb.Migrate(setup, dialect); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if _, err := setup.ExecContext(context.Background(),
		`TRUNCATE alert_events, alert_fingerprints, alert_claims, alert_comments RESTART IDENTITY CASCADE`,
	); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	if err := setup.Close(); err != nil {
		t.Fatalf("close setup conn: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	podA := newFanoutTestPod(t, dsn, logger)
	podB := newFanoutTestPod(t, dsn, logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go podA.fanout.Run(ctx, HandleFanoutMessage(podA.hub), HandleFanoutRef(podA.store, podA.hub, logger))
	go podB.fanout.Run(ctx, HandleFanoutMessage(podB.hub), HandleFanoutRef(podB.store, podB.hub, logger))
	time.Sleep(300 * time.Millisecond)

	clientB := connectWSClient(t, podB.hub)

	if err := podA.store.UpsertFingerprint("1234567890abcdef", "TestAlert", "c1", map[string]string{"alertname": "TestAlert"}); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}

	// maxCommentBodyLen is 10,000 chars — comfortably past
	// fanout.maxNotifyPayloadBytes (7800) once JSON-wrapped, so this must hit
	// the Ref fallback rather than embedding the full message.
	hugeBody := strings.Repeat("x", 9000)
	e := echo.New()
	reqBody, err := json.Marshal(map[string]string{"authorName": "alice", "body": hugeBody})
	if err != nil {
		t.Fatalf("marshal request body: %v", err)
	}
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/?cluster=c1", strings.NewReader(string(reqBody)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("1234567890abcdef")
	if err := podA.server.addComment(c); err != nil {
		t.Fatalf("addComment: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("addComment status = %d, want 201, body=%s", rec.Code, rec.Body.String())
	}

	msgB := readWSMessage(t, clientB, 5*time.Second)
	assertCommentAddedMessage(t, msgB, hugeBody)
}

type fanoutTestPod struct {
	store  *history.Store
	hub    *ws.Hub
	fanout *fanout.PGFanout
	server *Server
}

func newFanoutTestPod(t *testing.T, dsn string, logger *slog.Logger) *fanoutTestPod {
	t.Helper()
	database, dialect, err := idb.Open(dsn)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	store := history.NewStore(database, dialect)
	hub := ws.NewHub(nil, logger, metrics.New("test-fanout"))
	go hub.Run()
	f := fanout.NewPGFanout(database, dsn, logger)

	alertStore := &history.AlertStore{}
	silenceStore := history.NewSilenceStore()
	registry := cluster.NewRegistry(nil)
	userStore := users.NewStore(database, dialect)
	srv := NewServer(alertStore, silenceStore, store, hub, registry, &config.Config{}, nil, auth.NoneProvider{}, userStore, f)

	return &fanoutTestPod{store: store, hub: hub, fanout: f, server: srv}
}

func connectWSClient(t *testing.T, hub *ws.Hub) *websocket.Conn {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(hub.ServeWS))
	t.Cleanup(srv.Close)
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial ws: %v", err)
	}
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	t.Cleanup(func() { _ = conn.Close() })
	// Give the hub time to register the client before anything broadcasts.
	time.Sleep(50 * time.Millisecond)
	return conn
}

func readWSMessage(t *testing.T, conn *websocket.Conn, timeout time.Duration) []byte {
	t.Helper()
	if err := conn.SetReadDeadline(time.Now().Add(timeout)); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}
	_, msg, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read ws message: %v", err)
	}
	return msg
}

func assertNoFurtherMessage(t *testing.T, conn *websocket.Conn, wait time.Duration) {
	t.Helper()
	if err := conn.SetReadDeadline(time.Now().Add(wait)); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}
	_, msg, err := conn.ReadMessage()
	if err == nil {
		t.Fatalf("unexpected extra message (double delivery): %s", msg)
	}
}

func assertCommentAddedMessage(t *testing.T, msg []byte, wantBody string) {
	t.Helper()
	var event struct {
		Type    string `json:"type"`
		Payload struct {
			Fingerprint string `json:"fingerprint"`
			Comment     struct {
				Body string `json:"body"`
			} `json:"comment"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(msg, &event); err != nil {
		t.Fatalf("unmarshal ws message: %v (raw: %s)", err, msg)
	}
	if event.Type != "comment_added" {
		t.Fatalf("event type = %q, want comment_added (raw: %s)", event.Type, msg)
	}
	if event.Payload.Comment.Body != wantBody {
		t.Errorf("comment body = %q, want %q", event.Payload.Comment.Body, wantBody)
	}
}
