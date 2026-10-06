package auth

import (
	"strings"
	"sync"
	"time"
)

const (
	// loginFreeAttempts failed logins per username cost nothing; every one after
	// that doubles the wait, starting at loginBaseWait.
	loginFreeAttempts = 5
	loginBaseWait     = 2 * time.Second
	// loginMaxWait caps the wait so a targeted attacker can lock a user out for
	// at most this long at a time.
	loginMaxWait = 5 * time.Minute
	// loginDecayAfter is how long after its last failure an unlocked counter is forgotten.
	loginDecayAfter = 15 * time.Minute
	// loginMaxTracked bounds memory against an attacker spraying random usernames.
	loginMaxTracked = 10000
)

type throttleEntry struct {
	failures    int
	lastFailure time.Time
	lockedUntil time.Time
}

// LoginThrottle slows down repeated failed logins per submitted username with
// an exponentially growing wait. It keys on the name as typed, whether or not
// the account exists, so its behaviour never reveals which accounts do. State
// is per process; with several replicas each pod counts on its own. A nil
// *LoginThrottle is a no-op.
type LoginThrottle struct {
	mu      sync.Mutex
	entries map[string]*throttleEntry
	// inflight holds the names whose attempt is being checked right now. It
	// only ever holds as many names as there are concurrent requests.
	inflight map[string]struct{}
	now      func() time.Time
}

func NewLoginThrottle() *LoginThrottle {
	return &LoginThrottle{entries: make(map[string]*throttleEntry), inflight: make(map[string]struct{}), now: time.Now}
}

// SetClock replaces the time source; for tests.
func (t *LoginThrottle) SetClock(now func() time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.now = now
}

func throttleKey(username string) string {
	return strings.ToLower(strings.TrimSpace(username))
}

// Wait returns how long the username must still wait before another attempt
// is allowed, or 0 if it may try now.
func (t *LoginThrottle) Wait(username string) time.Duration {
	if t == nil {
		return 0
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	e, ok := t.entries[throttleKey(username)]
	if !ok {
		return 0
	}
	now := t.now()
	if now.Before(e.lockedUntil) {
		return e.lockedUntil.Sub(now)
	}
	if now.Sub(e.lastFailure) > loginDecayAfter {
		delete(t.entries, throttleKey(username))
	}
	return 0
}

// loginInflightWait is the Retry-After for an attempt rejected because another
// attempt for the same name is still being checked.
const loginInflightWait = time.Second

// TryAcquire atomically checks the wait and reserves the name for one attempt.
// ok is true when the caller may check the credentials; it must then call
// exactly one of Fail, Succeed or Release. Otherwise wait says how long to
// tell the client to hold off: the remaining wait, or loginInflightWait while
// another attempt for the same name is in flight. Serializing attempts per
// name keeps parallel requests from all slipping through a check-then-act gap
// when a wait has just expired.
func (t *LoginThrottle) TryAcquire(username string) (wait time.Duration, ok bool) {
	if t == nil {
		return 0, true
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	key := throttleKey(username)
	now := t.now()
	if e, found := t.entries[key]; found {
		if now.Before(e.lockedUntil) {
			return e.lockedUntil.Sub(now), false
		}
		if now.Sub(e.lastFailure) > loginDecayAfter {
			delete(t.entries, key)
		}
	}
	if _, busy := t.inflight[key]; busy {
		return loginInflightWait, false
	}
	t.inflight[key] = struct{}{}
	return 0, true
}

// Release gives the name back without counting a failure, for attempts that
// ended for a reason that is not the user's fault (e.g. a database error).
func (t *LoginThrottle) Release(username string) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.inflight, throttleKey(username))
}

// Fail records a failed login and releases the name. Callers only call it for
// attempts that were actually checked, so attempts rejected during a wait do
// not extend it.
func (t *LoginThrottle) Fail(username string) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	key := throttleKey(username)
	delete(t.inflight, key)
	now := t.now()
	e, ok := t.entries[key]
	if ok && now.Sub(e.lastFailure) > loginDecayAfter && !now.Before(e.lockedUntil) {
		ok = false
	}
	if !ok {
		if len(t.entries) >= loginMaxTracked {
			t.evictLocked(now)
			if len(t.entries) >= loginMaxTracked {
				return
			}
		}
		e = &throttleEntry{}
		t.entries[key] = e
	}
	e.failures++
	e.lastFailure = now
	if e.failures > loginFreeAttempts {
		shift := e.failures - loginFreeAttempts - 1
		wait := loginMaxWait
		if shift < 20 {
			wait = min(loginBaseWait<<shift, loginMaxWait)
		}
		e.lockedUntil = now.Add(wait)
	}
}

// Succeed forgets the failures of a username after a successful login and
// releases the name.
func (t *LoginThrottle) Succeed(username string) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	key := throttleKey(username)
	delete(t.entries, key)
	delete(t.inflight, key)
}

// evictLocked drops entries that are neither locked nor recent. Locked entries
// stay, so a flood of new names cannot reset a targeted user's wait.
func (t *LoginThrottle) evictLocked(now time.Time) {
	for k, e := range t.entries {
		if !now.Before(e.lockedUntil) && now.Sub(e.lastFailure) > loginDecayAfter {
			delete(t.entries, k)
		}
	}
}

func (t *LoginThrottle) size() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.entries)
}
