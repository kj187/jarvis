package fanout

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	idb "github.com/kj187/jarvis/backend/internal/db"
)

func postgresTestDSN(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("JARVIS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("JARVIS_TEST_POSTGRES_DSN not set — skipping PostgreSQL-backed test")
	}
	return dsn
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func newTestPGFanout(t *testing.T, dsn string) (*PGFanout, *sql.DB) {
	t.Helper()
	db, _, err := idb.Open(dsn)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewPGFanout(db, dsn, testLogger()), db
}

// waitFor polls cond every 20ms until it returns true or timeout elapses,
// failing the test in the latter case.
func waitFor(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("condition not met within %v", timeout)
}

// collector is a thread-safe sink for onMessage/onRef callbacks.
type collector struct {
	mu       sync.Mutex
	messages [][]byte
	refs     []Ref
}

func (c *collector) onMessage(msg []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.messages = append(c.messages, msg)
}

func (c *collector) onRef(ref Ref) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.refs = append(c.refs, ref)
}

func (c *collector) messageCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.messages)
}

func (c *collector) refCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.refs)
}

func (c *collector) lastMessage() []byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.messages) == 0 {
		return nil
	}
	return c.messages[len(c.messages)-1]
}

func (c *collector) lastRef() Ref {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.refs[len(c.refs)-1]
}

func TestPGFanout_DeliversToOtherInstanceOnly(t *testing.T) {
	dsn := postgresTestDSN(t)
	fanoutA, _ := newTestPGFanout(t, dsn)
	fanoutB, _ := newTestPGFanout(t, dsn)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	collA := &collector{}
	collB := &collector{}
	go fanoutA.Run(ctx, collA.onMessage, collA.onRef)
	go fanoutB.Run(ctx, collB.onMessage, collB.onRef)

	// Give both LISTEN connections time to establish before publishing.
	time.Sleep(300 * time.Millisecond)

	fanoutA.Publish(context.Background(), []byte(`{"type":"comment_added"}`), Ref{Type: "comment_added"})

	waitFor(t, 5*time.Second, func() bool { return collB.messageCount() == 1 })
	// A must NOT see its own publish (echo suppression) — give it a further
	// beat to (incorrectly) receive it, if suppression were broken.
	time.Sleep(300 * time.Millisecond)
	if collA.messageCount() != 0 {
		t.Errorf("publisher must not receive its own message, got %d", collA.messageCount())
	}

	var got map[string]string
	if err := json.Unmarshal(collB.lastMessage(), &got); err != nil {
		t.Fatalf("unmarshal delivered message: %v", err)
	}
	if got["type"] != "comment_added" {
		t.Errorf("delivered message = %v, want type=comment_added", got)
	}
}

func TestPGFanout_OversizedMessage_FallsBackToRef(t *testing.T) {
	dsn := postgresTestDSN(t)
	fanoutA, _ := newTestPGFanout(t, dsn)
	fanoutB, _ := newTestPGFanout(t, dsn)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	collB := &collector{}
	go fanoutA.Run(ctx, func([]byte) {}, func(Ref) {})
	go fanoutB.Run(ctx, collB.onMessage, collB.onRef)
	time.Sleep(300 * time.Millisecond)

	huge := []byte(`{"body":"` + strings.Repeat("x", maxNotifyPayloadBytes) + `"}`)
	ref := Ref{Type: "comment_added", Fingerprint: "fp1", ClusterName: "a", ID: "42"}
	fanoutA.Publish(context.Background(), huge, ref)

	waitFor(t, 5*time.Second, func() bool { return collB.refCount() == 1 })
	if collB.messageCount() != 0 {
		t.Errorf("oversized publish must not deliver as a message, got %d messages", collB.messageCount())
	}
	if got := collB.lastRef(); got != ref {
		t.Errorf("delivered ref = %+v, want %+v", got, ref)
	}
}

func TestPGFanout_SmallMessage_DeliveredInline(t *testing.T) {
	dsn := postgresTestDSN(t)
	fanoutA, _ := newTestPGFanout(t, dsn)
	fanoutB, _ := newTestPGFanout(t, dsn)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	collB := &collector{}
	go fanoutA.Run(ctx, func([]byte) {}, func(Ref) {})
	go fanoutB.Run(ctx, collB.onMessage, collB.onRef)
	time.Sleep(300 * time.Millisecond)

	fanoutA.Publish(context.Background(), []byte(`{"small":true}`), Ref{Type: "claim_set"})

	waitFor(t, 5*time.Second, func() bool { return collB.messageCount() == 1 })
	if collB.refCount() != 0 {
		t.Errorf("small publish must not fall back to a ref, got %d refs", collB.refCount())
	}
}
