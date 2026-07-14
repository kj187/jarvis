package leader

import (
	"context"
	"io"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"
)

// postgresTestDSN returns the PostgreSQL test DSN from JARVIS_TEST_POSTGRES_DSN,
// or skips the calling test if unset. Mirrors
// internal/history/store_postgres_test.go's helper of the same name — see
// .agents/testing.md for how to run these locally (make up-postgres).
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

// newTestPGElector returns a PGElector wired for fast tests (300ms
// retry/heartbeat instead of the 5s Binding Constant default) and registers
// it to stop when ctx is cancelled by the caller.
func newTestPGElector(t *testing.T, dsn string) *PGElector {
	t.Helper()
	e := NewPGElector(dsn, testLogger())
	e.SetRetryInterval(300 * time.Millisecond)
	return e
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

func TestPGElector_ExactlyOneLeader(t *testing.T) {
	dsn := postgresTestDSN(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	e1 := newTestPGElector(t, dsn)
	e2 := newTestPGElector(t, dsn)
	go e1.Run(ctx)
	go e2.Run(ctx)

	waitFor(t, 5*time.Second, func() bool { return e1.IsLeader() || e2.IsLeader() })
	// Give the loser a further beat to (incorrectly) also acquire, if the
	// lock were broken.
	time.Sleep(300 * time.Millisecond)

	if e1.IsLeader() == e2.IsLeader() {
		t.Fatalf("expected exactly one leader, got e1=%v e2=%v", e1.IsLeader(), e2.IsLeader())
	}
}

func TestPGElector_Failover(t *testing.T) {
	dsn := postgresTestDSN(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	e1 := newTestPGElector(t, dsn)
	e2 := newTestPGElector(t, dsn)

	// Each elector gets its own cancellable context so killing "the leader's
	// pod" (below) doesn't affect the other one — a plain context.WithCancel
	// per elector, not one shared context, mirrors two independent pods.
	ctx1, cancel1 := context.WithCancel(ctx)
	ctx2, cancel2 := context.WithCancel(ctx)
	defer cancel1() // no-op if already called below via cancelLeader
	defer cancel2()
	go e1.Run(ctx1)
	go e2.Run(ctx2)

	// Which of the two wins the initial race is non-deterministic — assert
	// only that exactly one does, then work with whichever it is.
	waitFor(t, 5*time.Second, func() bool { return e1.IsLeader() || e2.IsLeader() })

	follower, cancelLeader := e2, cancel1
	if e2.IsLeader() {
		follower, cancelLeader = e1, cancel2
	}
	if follower.IsLeader() {
		t.Fatalf("expected exactly one leader, got e1=%v e2=%v", e1.IsLeader(), e2.IsLeader())
	}

	// Simulate the leader pod being killed: cancelling its Run context closes
	// its dedicated connection, which releases the PostgreSQL session lock.
	cancelLeader()

	waitFor(t, 5*time.Second, func() bool { return follower.IsLeader() })
}

func TestPGElector_Subscribe_FiresImmediatelyThenOnPromotion(t *testing.T) {
	dsn := postgresTestDSN(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	e := newTestPGElector(t, dsn)

	var mu sync.Mutex
	var transitions []bool
	// Subscribe before Run: the immediate synchronous call sees the
	// not-yet-connected state (false) — matches the documented Elector
	// contract ("including once immediately for the initial state") and
	// StaticElector's behavior, so Recorder's mode supervisor can rely on it
	// uniformly across both Elector implementations.
	e.Subscribe(func(v bool) {
		mu.Lock()
		transitions = append(transitions, v)
		mu.Unlock()
	})

	go e.Run(ctx)
	waitFor(t, 5*time.Second, func() bool { return e.IsLeader() })

	mu.Lock()
	defer mu.Unlock()
	if len(transitions) != 2 || transitions[0] != false || transitions[1] != true {
		t.Fatalf("expected [false, true] (immediate + promotion), got %v", transitions)
	}
}
