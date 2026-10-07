package auth

import (
	"errors"
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
	// Each reservation carries a generation, so a stale holder (a deferred
	// Release after Fail, or after a panic) never frees a later request's.
	inflight map[string]uint64
	gen      uint64
	now      func() time.Time
}

func NewLoginThrottle() *LoginThrottle {
	return &LoginThrottle{entries: make(map[string]*throttleEntry), inflight: make(map[string]uint64), now: time.Now}
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

var (
	// ErrLoginLocked means the name is within its wait.
	ErrLoginLocked = errors.New("login wait active")
	// ErrLoginInProgress means another attempt for the name is being checked.
	ErrLoginInProgress = errors.New("login in progress")
)

// LoginAttempt is one reservation of a username, returned by TryAcquire. Its
// methods only act while the reservation is still the current one, so
// `defer attempt.Release()` is safe after Fail or Succeed and covers panics.
// The nil value is a no-op.
type LoginAttempt struct {
	t   *LoginThrottle
	key string
	gen uint64
}

// TryAcquire atomically checks the wait and reserves the name for one attempt.
// On success it returns the attempt, which must end with Fail, Succeed or
// Release. Otherwise the attempt is nil, err is ErrLoginLocked or
// ErrLoginInProgress, and wait says how long to tell the client to hold off.
// Serializing attempts per name keeps parallel requests from all slipping
// through a check-then-act gap when a wait has just expired. With a nil
// throttle it returns a nil attempt and no error.
func (t *LoginThrottle) TryAcquire(username string) (attempt *LoginAttempt, wait time.Duration, err error) {
	if t == nil {
		return nil, 0, nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	key := throttleKey(username)
	now := t.now()
	if e, found := t.entries[key]; found {
		if now.Before(e.lockedUntil) {
			return nil, e.lockedUntil.Sub(now), ErrLoginLocked
		}
		if now.Sub(e.lastFailure) > loginDecayAfter {
			delete(t.entries, key)
		}
	}
	if _, busy := t.inflight[key]; busy {
		return nil, loginInflightWait, ErrLoginInProgress
	}
	t.gen++
	t.inflight[key] = t.gen
	return &LoginAttempt{t: t, key: key, gen: t.gen}, 0, nil
}

// releaseLocked drops the reservation if it is still this attempt's.
func (a *LoginAttempt) releaseLocked() {
	if a.t.inflight[a.key] == a.gen {
		delete(a.t.inflight, a.key)
	}
}

// Release gives the name back without counting a failure.
func (a *LoginAttempt) Release() {
	if a == nil {
		return
	}
	a.t.mu.Lock()
	defer a.t.mu.Unlock()
	a.releaseLocked()
}

// Fail records a failed login and releases the name.
func (a *LoginAttempt) Fail() {
	if a == nil {
		return
	}
	a.t.mu.Lock()
	defer a.t.mu.Unlock()
	a.releaseLocked()
	a.t.failLocked(a.key)
}

// Succeed forgets the failures of the username and releases the name.
func (a *LoginAttempt) Succeed() {
	if a == nil {
		return
	}
	a.t.mu.Lock()
	defer a.t.mu.Unlock()
	a.releaseLocked()
	delete(a.t.entries, a.key)
}

// Fail records a failed login. Callers only call it for attempts that were
// actually checked, so attempts rejected during a wait do not extend it.
func (t *LoginThrottle) Fail(username string) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.failLocked(throttleKey(username))
}

func (t *LoginThrottle) failLocked(key string) {
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

// Succeed forgets the failures of a username after a successful login.
func (t *LoginThrottle) Succeed(username string) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.entries, throttleKey(username))
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
