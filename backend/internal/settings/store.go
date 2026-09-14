// Package settings stores each user's settings as an opaque JSON blob (see
// tmp/settings_storage.md §4.4) — this package never inspects individual
// setting keys, so a new frontend setting never requires a backend change.
package settings

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	idb "github.com/kj187/jarvis/backend/internal/db"
)

// Store handles all database operations for the user_settings table.
type Store struct {
	db      *sql.DB
	dialect idb.Dialect
}

// NewStore creates a new Store.
func NewStore(database *sql.DB, dialect idb.Dialect) *Store {
	return &Store{db: database, dialect: dialect}
}

// rebind converts SQLite-style ? placeholders to PostgreSQL $N placeholders.
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

// Get returns the raw settings JSON for a user. Returns ("", nil) when the
// user has no row yet — that is not an error.
func (s *Store) Get(ctx context.Context, userID string) (string, error) {
	q := s.rebind(`SELECT settings FROM user_settings WHERE user_id = ?`)
	var settingsJSON string
	err := s.db.QueryRowContext(ctx, q, userID).Scan(&settingsJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("settings.Get: %w", err)
	}
	return settingsJSON, nil
}

// Put replaces a user's settings row (insert or update). Last write wins —
// no merge, no versioning (tmp/settings_storage.md §4.5).
func (s *Store) Put(ctx context.Context, userID, settingsJSON string) error {
	q := s.rebind(`
		INSERT INTO user_settings (user_id, settings, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT (user_id) DO UPDATE SET
		  settings   = excluded.settings,
		  updated_at = excluded.updated_at
	`)
	if _, err := s.db.ExecContext(ctx, q, userID, settingsJSON, time.Now().UTC()); err != nil {
		return fmt.Errorf("settings.Put: %w", err)
	}
	return nil
}

// Delete removes a user's settings row. Deleting a non-existent row is a no-op.
func (s *Store) Delete(ctx context.Context, userID string) error {
	q := s.rebind(`DELETE FROM user_settings WHERE user_id = ?`)
	if _, err := s.db.ExecContext(ctx, q, userID); err != nil {
		return fmt.Errorf("settings.Delete: %w", err)
	}
	return nil
}
