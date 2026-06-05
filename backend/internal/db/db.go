package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// Open opens (or creates) the SQLite database at the given path.
// It creates the parent directory if needed and applies required PRAGMAs.
func Open(path string) (*sql.DB, error) {
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			return nil, fmt.Errorf("create db directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// Single writer — prevents "database is locked" errors.
	db.SetMaxOpenConns(1)

	pragmas := []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA foreign_keys=ON",
		"PRAGMA busy_timeout=5000",
	}
	for _, p := range pragmas {
		if _, err := db.Exec(p); err != nil {
			return nil, fmt.Errorf("apply pragma %q: %w", p, err)
		}
	}

	return db, nil
}

// Migrate creates all tables and indexes (idempotent — safe to call on startup).
func Migrate(db *sql.DB) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS alert_fingerprints (
			fingerprint      TEXT PRIMARY KEY,
			alertname        TEXT NOT NULL,
			cluster_name     TEXT NOT NULL,
			labels           TEXT NOT NULL,
			first_seen_at    DATETIME NOT NULL,
			last_seen_at     DATETIME NOT NULL,
			occurrence_count INTEGER DEFAULT 1
		)`,
		`CREATE TABLE IF NOT EXISTS alert_events (
			id               INTEGER PRIMARY KEY AUTOINCREMENT,
			fingerprint      TEXT NOT NULL REFERENCES alert_fingerprints(fingerprint),
			cluster_name     TEXT NOT NULL,
			alertmanager_url TEXT NOT NULL,
			status           TEXT NOT NULL,
			starts_at        DATETIME NOT NULL,
			ends_at          DATETIME,
			annotations      TEXT,
			recorded_at      DATETIME NOT NULL DEFAULT (datetime('now'))
		)`,
		`CREATE TABLE IF NOT EXISTS alert_comments (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			fingerprint  TEXT NOT NULL REFERENCES alert_fingerprints(fingerprint),
			event_id     INTEGER REFERENCES alert_events(id),
			author_name  TEXT NOT NULL,
			body         TEXT NOT NULL,
			created_at   DATETIME NOT NULL DEFAULT (datetime('now'))
		)`,
		`CREATE TABLE IF NOT EXISTS alert_claims (
			id             INTEGER PRIMARY KEY AUTOINCREMENT,
			fingerprint    TEXT NOT NULL REFERENCES alert_fingerprints(fingerprint),
			event_id       INTEGER REFERENCES alert_events(id),
			claimed_by     TEXT NOT NULL,
			claimed_at     DATETIME NOT NULL DEFAULT (datetime('now')),
			note           TEXT,
			released_at    DATETIME,
			released_by    TEXT,
			release_reason TEXT
		)`,
		`CREATE INDEX IF NOT EXISTS idx_alert_events_fingerprint ON alert_events(fingerprint)`,
		`CREATE INDEX IF NOT EXISTS idx_alert_events_starts_at   ON alert_events(starts_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_alert_comments_fingerprint ON alert_comments(fingerprint)`,
		`CREATE INDEX IF NOT EXISTS idx_alert_claims_fingerprint ON alert_claims(fingerprint)`,
		`CREATE INDEX IF NOT EXISTS idx_alert_claims_active      ON alert_claims(fingerprint) WHERE released_at IS NULL`,
	}

	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
	}
	return nil
}
