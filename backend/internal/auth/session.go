package auth

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/kj187/jarvis/backend/internal/users"
)

var (
	// ErrInvalidSession: bad or expired token, deleted user, or a token issued
	// before the user's last logout.
	ErrInvalidSession = errors.New("invalid session")
	// ErrSessionUnavailable: the user store could not be asked and no cached
	// answer exists. Callers answer 503, not 401, so a database blip does not
	// log everyone out.
	ErrSessionUnavailable = errors.New("session store unavailable")
)

const sessionCacheMax = 1024

// UserLookup is the part of users.Store the verifier needs.
type UserLookup interface {
	GetByID(ctx context.Context, id string) (*users.User, error)
}

type sessionEntry struct {
	user    *users.User // nil: the user does not exist
	fetched time.Time
}

// SessionVerifier validates a session token against the users table: the user
// must exist and the token's version must be the user's current one. Role,
// name and e-mail come from the database, not from the token. Answers are
// cached for ttl per user; Invalidate drops one immediately.
type SessionVerifier struct {
	key    []byte
	lookup UserLookup
	ttl    time.Duration

	mu    sync.Mutex
	cache map[string]sessionEntry
	// gen counts Invalidate calls. A lookup that started before an Invalidate
	// may hold a pre-invalidation row, so it must not be written to the cache.
	gen uint64
}

func NewSessionVerifier(key []byte, lookup UserLookup, ttl time.Duration) *SessionVerifier {
	return &SessionVerifier{key: key, lookup: lookup, ttl: ttl, cache: make(map[string]sessionEntry)}
}

// Verify returns the current user behind a session token.
func (v *SessionVerifier) Verify(ctx context.Context, token string) (*User, error) {
	claims, err := ParseToken(v.key, token)
	if err != nil || claims.ID == "" {
		return nil, ErrInvalidSession
	}
	u, err := v.userFor(ctx, claims.ID)
	if err != nil {
		return nil, err
	}
	if u == nil || u.TokenVersion != claims.TokenVersion {
		return nil, ErrInvalidSession
	}
	return &User{
		ID:           u.ID,
		Username:     u.Username,
		Email:        u.Email,
		Role:         u.Role,
		Provider:     u.Provider,
		TokenVersion: u.TokenVersion,
	}, nil
}

// StillValid is the check for connections that are already established. It
// fails open: an unreachable database must not drop every open stream.
func (v *SessionVerifier) StillValid(ctx context.Context, userID string, tokenVersion int) bool {
	u, err := v.userFor(ctx, userID)
	if err != nil {
		return true
	}
	return u != nil && u.TokenVersion == tokenVersion
}

// Invalidate drops the cached answer for a user so the next request asks the database.
func (v *SessionVerifier) Invalidate(userID string) {
	v.mu.Lock()
	delete(v.cache, userID)
	v.gen++
	v.mu.Unlock()
}

func (v *SessionVerifier) userFor(ctx context.Context, id string) (*users.User, error) {
	now := time.Now()
	v.mu.Lock()
	e, cached := v.cache[id]
	gen := v.gen
	v.mu.Unlock()
	if cached && now.Sub(e.fetched) < v.ttl {
		return e.user, nil
	}

	u, err := v.lookup.GetByID(ctx, id)
	if err != nil {
		if cached {
			return e.user, nil
		}
		return nil, ErrSessionUnavailable
	}

	v.mu.Lock()
	if len(v.cache) >= sessionCacheMax {
		for k, old := range v.cache {
			if now.Sub(old.fetched) >= v.ttl {
				delete(v.cache, k)
			}
		}
	}
	if v.gen == gen && len(v.cache) < sessionCacheMax {
		v.cache[id] = sessionEntry{user: u, fetched: now}
	}
	v.mu.Unlock()
	return u, nil
}

var activeVerifier atomic.Pointer[SessionVerifier]

// SetSessionVerifier installs the verifier the auth middleware uses. Called
// once at startup (NewRouter).
func SetSessionVerifier(v *SessionVerifier) {
	activeVerifier.Store(v)
}

// InvalidateUser drops the installed verifier's cached answer for a user, so a
// role change, deletion or logout handled on this pod applies immediately.
func InvalidateUser(userID string) {
	if v := activeVerifier.Load(); v != nil {
		v.Invalidate(userID)
	}
}
