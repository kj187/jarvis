package leader

import (
	"context"
	"hash/fnv"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
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
// retry/heartbeat instead of the 5s Binding Constant default) and pinned to
// a lock ID unique to the calling test (see testLockID) so that concurrently
// running PG-backed elector tests — here and in internal/history — don't all
// fight over the one production advisory lock and time each other out.
// Electors created for the same test share the ID and therefore contend, as
// intended.
func newTestPGElector(t *testing.T, dsn string) *PGElector {
	t.Helper()
	e := NewPGElector(dsn, testLogger())
	e.SetRetryInterval(300 * time.Millisecond)
	classID, id := testLockID(t)
	e.SetLockID(classID, id)
	return e
}

// testLockID derives an advisory-lock namespace for a test: the class ID is
// the test process PID (distinct per `go test` package binary, so two
// packages' elector tests can't collide even on the same DB), the lock ID is
// a hash of the test name (stable within a test, distinct between tests).
func testLockID(t *testing.T) (int32, int32) {
	t.Helper()
	h := fnv.New32a()
	_, _ = h.Write([]byte(t.Name()))
	return int32(os.Getpid()), int32(h.Sum32() & 0x7fffffff) // #nosec G115 -- a PID and a 31-bit masked hash fit int32
}

// waitFor polls cond every 20ms until it returns true or timeout elapses,
// failing the test in the latter case. The timeout is a generous ceiling for
// a heavily loaded CI runner, not an expected duration — a passing check
// returns as soon as cond() is true.
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

	waitFor(t, 20*time.Second, func() bool { return e1.IsLeader() || e2.IsLeader() })
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
	waitFor(t, 20*time.Second, func() bool { return e1.IsLeader() || e2.IsLeader() })

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

	waitFor(t, 20*time.Second, func() bool { return follower.IsLeader() })
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
	waitFor(t, 20*time.Second, func() bool { return e.IsLeader() })

	mu.Lock()
	defer mu.Unlock()
	if len(transitions) != 2 || transitions[0] != false || transitions[1] != true {
		t.Fatalf("expected [false, true] (immediate + promotion), got %v", transitions)
	}
}

// TestPGElector_BlackholedLeaderStepsDownAndFollowerTakesOver is the failover
// proof behind docs/postgres-ha.md: a leader whose network path to PostgreSQL
// is blackholed (no FIN, no RST — TCP keepalive never fires while data is
// unacknowledged) must notice through its heartbeat timeout and give up
// leadership within a bounded time, and only then may the follower take over.
// There is never a moment with two leaders.
func TestPGElector_BlackholedLeaderStepsDownAndFollowerTakesOver(t *testing.T) {
	dsn := postgresTestDSN(t)
	proxy, proxiedDSN := newBlackholeProxy(t, dsn)

	ctx, cancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup
	t.Cleanup(func() {
		cancel()
		wg.Wait()
	})

	// Same lock for both: the leader reaches PostgreSQL through the proxy, the
	// follower directly.
	leader := NewPGElector(proxiedDSN, testLogger())
	follower := NewPGElector(dsn, testLogger())
	classID, id := testLockID(t)
	for _, e := range []*PGElector{leader, follower} {
		e.SetRetryInterval(300 * time.Millisecond)
		e.SetLockID(classID, id)
	}

	wg.Add(1)
	go func() { defer wg.Done(); leader.Run(ctx) }()
	waitFor(t, 20*time.Second, leader.IsLeader)
	wg.Add(1)
	go func() { defer wg.Done(); follower.Run(ctx) }()

	// Sample for a double leader for the whole rest of the test. The sampler
	// is stopped via Cleanup too, so a t.Fatalf above cannot leak it.
	var doubleLeader sync.Once
	var sawDouble bool
	stopSampling := make(chan struct{})
	samplerDone := make(chan struct{})
	var stopOnce sync.Once
	stopSampler := func() {
		stopOnce.Do(func() { close(stopSampling) })
		<-samplerDone
	}
	t.Cleanup(stopSampler)
	go func() {
		defer close(samplerDone)
		for {
			select {
			case <-stopSampling:
				return
			case <-time.After(5 * time.Millisecond):
				if leader.IsLeader() && follower.IsLeader() {
					doubleLeader.Do(func() { sawDouble = true })
				}
			}
		}
	}()

	blackholedAt := time.Now()
	proxy.Blackhole()

	// Bound: one heartbeat interval until the next probe plus the probe
	// timeout, with slack for a loaded CI runner. Without a heartbeat timeout
	// this waits for the kernel's TCP retransmission give-up (minutes).
	waitFor(t, 5*time.Second, func() bool { return !leader.IsLeader() })
	if d := time.Since(blackholedAt); d > 3*time.Second {
		t.Fatalf("blackholed leader took %v to step down, want a few heartbeat intervals", d)
	}
	if follower.IsLeader() {
		t.Fatal("follower took over while PostgreSQL still held the old leader's session lock")
	}

	// The server reaps the dead session (server-side keepalive): lock freed.
	proxy.DropUpstream()
	waitFor(t, 20*time.Second, follower.IsLeader)

	stopSampler()
	if sawDouble {
		t.Fatal("observed two leaders at the same time")
	}
}

// TestPGElector_BlackholedFollowerReconnects covers the follower path: a
// follower whose pg_try_advisory_lock round-trip hangs on a blackholed
// connection must give up after one retry interval and redial, instead of
// waiting for the kernel's TCP retransmission give-up (minutes).
func TestPGElector_BlackholedFollowerReconnects(t *testing.T) {
	dsn := postgresTestDSN(t)
	proxy, proxiedDSN := newBlackholeProxy(t, dsn)
	// Tag the proxied session so it can be found in pg_stat_activity.
	const appName = "jarvis-test-blackholed-follower"
	sep := "?"
	if strings.Contains(proxiedDSN, "?") {
		sep = "&"
	}
	proxiedDSN += sep + "application_name=" + appName

	ctx, cancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup
	t.Cleanup(func() {
		cancel()
		wg.Wait()
	})

	holder := NewPGElector(dsn, testLogger())
	follower := NewPGElector(proxiedDSN, testLogger())
	classID, id := testLockID(t)
	for _, e := range []*PGElector{holder, follower} {
		e.SetRetryInterval(300 * time.Millisecond)
		e.SetLockID(classID, id)
	}

	wg.Add(1)
	go func() { defer wg.Done(); holder.Run(ctx) }()
	waitFor(t, 20*time.Second, holder.IsLeader)

	wg.Add(1)
	go func() { defer wg.Done(); follower.Run(ctx) }()
	waitFor(t, 20*time.Second, func() bool { return proxy.Accepted() >= 1 })

	// Blackhole only after a try-lock round-trip completed on the proxied
	// session (visible server-side as an idle session whose last statement is
	// the try-lock). Otherwise a handshake or CancelRequest dial could also
	// raise Accepted() and the test would not prove the query deadline.
	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = admin.Close(context.Background()) })
	waitFor(t, 20*time.Second, func() bool {
		var n int
		err := admin.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity
			WHERE application_name = $1 AND state = 'idle' AND query LIKE 'SELECT pg_try_advisory_lock%'`, appName).Scan(&n)
		return err == nil && n > 0
	})

	before := proxy.Accepted()
	proxy.Blackhole()

	// One retry interval until the hung try-lock times out, then a redial.
	// The ceiling follows the waitFor convention (CI load), not the expected time.
	waitFor(t, 20*time.Second, func() bool { return proxy.Accepted() > before })
	if follower.IsLeader() {
		t.Fatal("follower became leader while the holder still owns the lock")
	}
}

// TestPGElector_DialAppliesConnectTimeout pins the connect deadline: without
// it a blackholed handshake blocks the Run loop until the kernel gives up.
func TestPGElector_DialAppliesConnectTimeout(t *testing.T) {
	e := NewPGElector("postgres://u:p@127.0.0.1:1/db?sslmode=disable", testLogger())
	e.SetRetryInterval(250 * time.Millisecond)
	cfg, err := e.connConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ConnectTimeout != 250*time.Millisecond {
		t.Fatalf("connect timeout = %v, want retry interval", cfg.ConnectTimeout)
	}
	e2 := NewPGElector("postgres://u:p@127.0.0.1:1/db?sslmode=disable&connect_timeout=7", testLogger())
	e2.SetRetryInterval(250 * time.Millisecond)
	cfg2, err := e2.connConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg2.ConnectTimeout != 7*time.Second {
		t.Fatalf("connect timeout = %v, want DSN value 7s", cfg2.ConnectTimeout)
	}
}
