package auth

import (
	"testing"
	"time"
)

func newTestThrottle() (*LoginThrottle, *time.Time) {
	now := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	th := NewLoginThrottle()
	th.now = func() time.Time { return now }
	return th, &now
}

func TestLoginThrottle_FreeAttemptsThenWait(t *testing.T) {
	th, _ := newTestThrottle()
	for i := 0; i < loginFreeAttempts; i++ {
		if w := th.Wait("alice"); w != 0 {
			t.Fatalf("attempt %d: wait = %v, want 0", i+1, w)
		}
		th.Fail("alice")
	}
	if w := th.Wait("alice"); w != 0 {
		t.Fatalf("after %d failures wait = %v, want 0", loginFreeAttempts, w)
	}
	th.Fail("alice")
	if w := th.Wait("alice"); w != loginBaseWait {
		t.Fatalf("first throttled failure: wait = %v, want %v", w, loginBaseWait)
	}
}

func TestLoginThrottle_TenFailuresLockOnlyThatUser(t *testing.T) {
	th, now := newTestThrottle()
	for i := 0; i < 10; i++ {
		th.Fail("alice")
		*now = now.Add(th.Wait("alice")) // a client that waits out each delay
	}
	th.Fail("alice")
	wait := th.Wait("alice")
	if wait <= 0 {
		t.Fatal("alice is not locked after repeated failures")
	}
	if w := th.Wait("bob"); w != 0 {
		t.Fatalf("bob wait = %v, want 0", w)
	}

	*now = now.Add(wait)
	if w := th.Wait("alice"); w != 0 {
		t.Fatalf("alice wait after the delay = %v, want 0", w)
	}
}

func TestLoginThrottle_WaitGrowsExponentiallyAndIsCapped(t *testing.T) {
	th, now := newTestThrottle()
	var prev time.Duration
	for i := 0; i < loginFreeAttempts+20; i++ {
		th.Fail("alice")
		w := th.Wait("alice")
		if w > loginMaxWait {
			t.Fatalf("wait %v exceeds cap %v", w, loginMaxWait)
		}
		if i > loginFreeAttempts && w < prev {
			t.Fatalf("wait shrank from %v to %v", prev, w)
		}
		prev = w
		*now = now.Add(w)
	}
	if prev != loginMaxWait {
		t.Fatalf("wait never reached the cap: %v", prev)
	}
}

func TestLoginThrottle_SuccessResets(t *testing.T) {
	th, _ := newTestThrottle()
	for i := 0; i < loginFreeAttempts+3; i++ {
		th.Fail("alice")
	}
	th.Succeed("alice")
	if w := th.Wait("alice"); w != 0 {
		t.Fatalf("wait after success = %v, want 0", w)
	}
	th.Fail("alice")
	if w := th.Wait("alice"); w != 0 {
		t.Fatalf("a single failure after a reset must be free, wait = %v", w)
	}
}

func TestLoginThrottle_UsernameIsNormalised(t *testing.T) {
	th, _ := newTestThrottle()
	for i := 0; i < loginFreeAttempts+1; i++ {
		th.Fail("Alice ")
	}
	if w := th.Wait("alice"); w == 0 {
		t.Fatal("case and whitespace variants must share one counter")
	}
}

func TestLoginThrottle_StaleEntriesDecay(t *testing.T) {
	th, now := newTestThrottle()
	for i := 0; i < loginFreeAttempts+2; i++ {
		th.Fail("alice")
	}
	*now = now.Add(loginMaxWait + loginDecayAfter + time.Second)
	if w := th.Wait("alice"); w != 0 {
		t.Fatalf("wait after decay = %v, want 0", w)
	}
	th.Fail("alice")
	if w := th.Wait("alice"); w != 0 {
		t.Fatalf("counter was not reset after decay, wait = %v", w)
	}
}

func TestLoginThrottle_MemoryIsBounded(t *testing.T) {
	th, _ := newTestThrottle()
	for i := 0; i < loginMaxTracked*2; i++ {
		th.Fail("user-" + time.Duration(i).String())
	}
	if n := th.size(); n > loginMaxTracked {
		t.Fatalf("tracked %d entries, want <= %d", n, loginMaxTracked)
	}
}

func TestLoginThrottle_NilIsDisabled(t *testing.T) {
	var th *LoginThrottle
	th.Fail("alice")
	th.Succeed("alice")
	if w := th.Wait("alice"); w != 0 {
		t.Fatalf("nil throttle wait = %v, want 0", w)
	}
}
