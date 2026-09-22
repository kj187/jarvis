// Package globalsettings is the generic admin-settings foundation
// (RBAC label-scoped-access plan, Phase 0): one row per "section" in a
// single global_settings table, addressed by a section name (e.g. the
// later "access" section). This package never interprets a section's
// value — it is opaque JSON here, exactly like internal/settings never
// inspects a user's settings blob. Section-specific meaning and validation
// are owned by whoever registers that section via Register.
package globalsettings

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	idb "github.com/kj187/jarvis/backend/internal/db"
)

// ErrSectionNotRegistered is returned by Set (and used by the admin API to
// answer 404) when no feature has registered the given section yet. Phase 0
// registers nothing, so every section is unknown until a later phase (e.g.
// Phase 1's "access") calls Register.
var ErrSectionNotRegistered = errors.New("globalsettings: section not registered")

// ErrValidation wraps (via errors.Join, so both errors.Is checks succeed) any
// error a section's Validator returns from Set — lets the admin API tell a
// 400 (bad input) apart from a 500 (Set's own DB failure).
var ErrValidation = errors.New("globalsettings: validation failed")

// Validator validates a section's raw JSON value before it is stored. A nil
// Validator means "any JSON value is accepted" — used by Phase 0's own
// tests; a real section (Phase 1's "access") registers a non-nil one.
type Validator func(value json.RawMessage) error

// Setting is one section's stored value, as returned by Get.
type Setting struct {
	Value     json.RawMessage
	UpdatedAt time.Time
	UpdatedBy string
}

// Store handles all database operations for the global_settings table,
// plus the section registry that gates Set (and, via Registered, the admin
// API's GET/PUT).
type Store struct {
	db      *sql.DB
	dialect idb.Dialect

	mu         sync.RWMutex
	validators map[string]Validator
}

// NewStore creates a new Store with an empty section registry.
func NewStore(database *sql.DB, dialect idb.Dialect) *Store {
	return &Store{db: database, dialect: dialect, validators: make(map[string]Validator)}
}

// Register adds (or replaces) a section's validator. A nil validator means
// "no validation" — any JSON value is accepted once the section is
// registered. Not safe to call concurrently with itself; intended to be
// called during startup wiring (cmd/jarvis/main.go), not per-request.
func (s *Store) Register(section string, v Validator) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.validators[section] = v
}

// Registered reports whether a section currently has a registered validator
// (including a nil one) — i.e. whether the admin API should serve it at
// all, independent of whether a value has ever been stored for it.
func (s *Store) Registered(section string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.validators[section]
	return ok
}

// Sections returns the currently registered section names, sorted.
func (s *Store) Sections() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]string, 0, len(s.validators))
	for name := range s.validators {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// rebind converts SQLite-style ? placeholders to PostgreSQL $N placeholders
// — same helper as internal/settings.Store and internal/users.Store.
func (s *Store) rebind(query string) string {
	if s.dialect == idb.DialectSQLite {
		return query
	}
	n := 0
	var b strings.Builder
	b.Grow(len(query) + 16)
	for _, ch := range query {
		if ch == '?' {
			n++
			b.WriteByte('$')
			b.WriteString(strconv.Itoa(n))
		} else {
			b.WriteRune(ch)
		}
	}
	return b.String()
}

// Get returns a section's stored value. Returns (nil, nil) when the section
// has no row yet — that is not an error, and is independent of whether the
// section is registered (Get never checks the registry; only Set does).
func (s *Store) Get(ctx context.Context, section string) (*Setting, error) {
	q := s.rebind(`SELECT value, updated_at, updated_by FROM global_settings WHERE key = ?`)
	var value string
	var updatedAt time.Time
	var updatedBy string
	err := s.db.QueryRowContext(ctx, q, section).Scan(&value, &updatedAt, &updatedBy) // #nosec G701 -- section is a bind param (?), never concatenated into q
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("globalsettings.Get: %w", err)
	}
	return &Setting{Value: json.RawMessage(value), UpdatedAt: updatedAt, UpdatedBy: updatedBy}, nil
}

// Set validates and stores a section's value (insert or update; last write
// wins, no merge — same contract as internal/settings.Store.Put). It fails
// with ErrSectionNotRegistered when no one has registered the section, and
// with the validator's own error when the value fails validation; neither
// case writes a row.
func (s *Store) Set(ctx context.Context, section string, value json.RawMessage, updatedBy string) error {
	s.mu.RLock()
	validate, ok := s.validators[section]
	s.mu.RUnlock()
	if !ok {
		return fmt.Errorf("%w: %q", ErrSectionNotRegistered, section)
	}
	if validate != nil {
		if err := validate(value); err != nil {
			return fmt.Errorf("globalsettings: validate %q: %w", section, errors.Join(ErrValidation, err))
		}
	}

	q := s.rebind(`
		INSERT INTO global_settings (key, value, updated_at, updated_by)
		VALUES (?, ?, ?, ?)
		ON CONFLICT (key) DO UPDATE SET
		  value      = excluded.value,
		  updated_at = excluded.updated_at,
		  updated_by = excluded.updated_by
	`)
	if _, err := s.db.ExecContext(ctx, q, section, string(value), time.Now().UTC(), updatedBy); err != nil { // #nosec G701 -- all four are bind params (?), never concatenated into q
		return fmt.Errorf("globalsettings.Set: %w", err)
	}
	return nil
}
