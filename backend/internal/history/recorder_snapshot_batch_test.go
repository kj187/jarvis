package history

import (
	"context"
	"fmt"
	"reflect"
	"sync/atomic"
	"testing"
	"time"
)

// TestFollowerDirtySet_MarkDedupesAndDrainSortsAndClears covers the small
// building block runFollowerBatchWorker uses to track which clusters need
// resyncing: repeated marks of the same name collapse to one entry, drain
// returns names sorted for deterministic batch processing, and a drained set
// is empty until marked again.
func TestFollowerDirtySet_MarkDedupesAndDrainSortsAndClears(t *testing.T) {
	d := newFollowerDirtySet()
	d.mark("b")
	d.mark("a")
	d.mark("a")

	got := d.drain()
	want := []string{"a", "b"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("drain = %v, want %v", got, want)
	}
	if got2 := d.drain(); len(got2) != 0 {
		t.Fatalf("second drain = %v, want empty (drain must clear the set)", got2)
	}
}

// waitForVersion polls the store's cache version until it reaches at least
// want or the deadline elapses, using AlertStore's own version counter (P4)
// as a cheap, already-available "how many rebuilds happened" instrument:
// AlertStore.Set always bumps the version, even for identical content, and
// rebuildFollowerAlertStore always calls Set exactly once per invocation.
func waitForVersion(t *testing.T, s *AlertStore, want uint64, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		s.mu.RLock()
		v := s.version
		s.mu.RUnlock()
		if v >= want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("version = %d, want >= %d within %v", v, want, timeout)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

func currentVersion(s *AlertStore) uint64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.version
}

// TestFollowerBatchWorker_CoalescesBurstIntoOneRebuild is P5's central
// regression test: four notifications for four different clusters arriving
// well within followerBurstWindow must produce exactly one rebuild
// (AlertStore.Set call, observed via its version counter), not four.
func TestFollowerBatchWorker_CoalescesBurstIntoOneRebuild(t *testing.T) {
	rec, _ := newTestRecorder(t)
	dirty := newFollowerDirtySet()
	signal := make(chan struct{}, 1)
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		defer close(done)
		rec.runFollowerBatchWorker(ctx, dirty, signal)
	}()
	t.Cleanup(func() {
		cancel()
		<-done
	})

	before := currentVersion(rec.alertStore)
	for i := 0; i < 4; i++ {
		dirty.mark(fmt.Sprintf("cluster-%d", i))
		select {
		case signal <- struct{}{}:
		default:
		}
		time.Sleep(20 * time.Millisecond) // well inside followerBurstWindow (200ms)
	}

	waitForVersion(t, rec.alertStore, before+1, 2*time.Second)
	// Give a would-be extra rebuild a chance to show up before asserting none did.
	time.Sleep(followerBurstWindow)
	if got := currentVersion(rec.alertStore) - before; got != 1 {
		t.Fatalf("rebuilds during one burst = %d, want exactly 1", got)
	}
}

// TestFollowerBatchWorker_FixedWindowNotResetByContinuousSignals verifies the
// burst deadline is fixed at the first signal and never pushed back by later
// ones — otherwise a continuous notification stream (a busy cluster) would
// starve the rebuild indefinitely instead of coalescing it into windows.
func TestFollowerBatchWorker_FixedWindowNotResetByContinuousSignals(t *testing.T) {
	rec, _ := newTestRecorder(t)
	dirty := newFollowerDirtySet()
	signal := make(chan struct{}, 1)
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		defer close(done)
		rec.runFollowerBatchWorker(ctx, dirty, signal)
	}()
	t.Cleanup(func() {
		cancel()
		<-done
	})

	before := currentVersion(rec.alertStore)
	stop := time.After(700 * time.Millisecond)
loop:
	for {
		select {
		case <-stop:
			break loop
		default:
		}
		dirty.mark("cluster-a")
		select {
		case signal <- struct{}{}:
		default:
		}
		time.Sleep(10 * time.Millisecond)
	}

	if got := currentVersion(rec.alertStore) - before; got < 2 {
		t.Fatalf("rebuilds during 700ms of continuous signalling = %d, want >= 2 (fixed window must not be pushed back indefinitely)", got)
	}
}

// TestFollowerBatchWorker_CancelDuringPendingBurstStopsCleanly verifies
// cancelling ctx while a burst timer is still pending (before it fires) makes
// the worker return promptly instead of blocking on the timer.
func TestFollowerBatchWorker_CancelDuringPendingBurstStopsCleanly(t *testing.T) {
	rec, _ := newTestRecorder(t)
	dirty := newFollowerDirtySet()
	signal := make(chan struct{}, 1)
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		defer close(done)
		rec.runFollowerBatchWorker(ctx, dirty, signal)
	}()

	dirty.mark("cluster-a")
	select {
	case signal <- struct{}{}:
	default:
	}
	time.Sleep(20 * time.Millisecond) // well before followerBurstWindow elapses
	cancel()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("runFollowerBatchWorker did not return promptly after cancel while a burst was pending")
	}
}

// TestFollowerResyncTicker_FiresIndependentlyOfNotifications verifies the
// full-resync ticker rebuilds on its own schedule with zero notification
// traffic — the independent fallback that replaces the old onIdle path,
// which could be starved by a continuous stream of *other* clusters'
// notifications.
func TestFollowerResyncTicker_FiresIndependentlyOfNotifications(t *testing.T) {
	rec, _ := newTestRecorder(t)
	rec.interval = 30 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		defer close(done)
		rec.runFollowerResyncTicker(ctx)
	}()
	t.Cleanup(func() {
		cancel()
		<-done
	})

	before := currentVersion(rec.alertStore)
	waitForVersion(t, rec.alertStore, before+2, 2*time.Second)
}

// TestModeSupervisor_NeverOverlapsConsecutiveModes is P5's regression test
// for the mode supervisor itself: a new mode request must never start its
// mode function before the previous one's has actually returned, even when
// requests arrive faster than the previous mode's teardown takes. The fake
// mode function sleeps briefly after observing ctx.Done() before releasing
// "active" — reproducing the old fire-and-forget bug (a demoted leader's
// still-finishing goroutine overlapping a newly started follower loop) would
// require exactly this kind of slow teardown to catch.
func TestModeSupervisor_NeverOverlapsConsecutiveModes(t *testing.T) {
	rec, _ := newTestRecorder(t)

	var active int32
	var overlapped int32
	slowMode := func(ctx context.Context) {
		if !atomic.CompareAndSwapInt32(&active, 0, 1) {
			atomic.StoreInt32(&overlapped, 1)
		}
		<-ctx.Done()
		time.Sleep(20 * time.Millisecond)
		atomic.StoreInt32(&active, 0)
	}

	ctx, cancel := context.WithCancel(context.Background())
	requests := make(chan bool, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		rec.runModeSupervisorWith(ctx, requests, slowMode, slowMode)
	}()

	requests <- true
	time.Sleep(10 * time.Millisecond)
	requests <- false
	time.Sleep(10 * time.Millisecond)
	requests <- true
	time.Sleep(80 * time.Millisecond)

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("runModeSupervisorWith did not shut down after ctx cancel")
	}

	if atomic.LoadInt32(&overlapped) != 0 {
		t.Fatal("supervisor started a new mode before the previous one's teardown finished")
	}
}
