package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
)

func ensureDir(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return fmt.Errorf("create db directory: %w", err)
	}
	return nil
}

func migrateSQLite(database *sql.DB) error {
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
		`CREATE TABLE IF NOT EXISTS silence_events (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			fingerprint  TEXT NOT NULL,
			silence_id   TEXT NOT NULL,
			cluster_name TEXT NOT NULL,
			action       TEXT NOT NULL,
			performed_by TEXT NOT NULL,
			comment      TEXT NOT NULL DEFAULT '',
			recorded_at  DATETIME NOT NULL DEFAULT (datetime('now'))
		)`,
		`CREATE INDEX IF NOT EXISTS idx_alert_events_fingerprint ON alert_events(fingerprint)`,
		`CREATE INDEX IF NOT EXISTS idx_alert_events_starts_at   ON alert_events(starts_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_alert_events_fingerprint_recorded ON alert_events(fingerprint, recorded_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_alert_comments_fingerprint ON alert_comments(fingerprint)`,
		`CREATE INDEX IF NOT EXISTS idx_alert_claims_fingerprint ON alert_claims(fingerprint)`,
		`CREATE INDEX IF NOT EXISTS idx_alert_claims_active      ON alert_claims(fingerprint) WHERE released_at IS NULL`,
		`CREATE INDEX IF NOT EXISTS idx_silence_events_fingerprint ON silence_events(fingerprint, recorded_at DESC)`,
		`CREATE TABLE IF NOT EXISTS users (
			id             TEXT PRIMARY KEY,
			username       TEXT NOT NULL UNIQUE,
			email          TEXT,
			password_hash  TEXT,
			role           TEXT NOT NULL DEFAULT 'user',
			provider       TEXT NOT NULL DEFAULT 'internal',
			oidc_sub       TEXT UNIQUE,
			created_at     DATETIME NOT NULL,
			last_login_at  DATETIME
		)`,
		`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`,
		`CREATE INDEX IF NOT EXISTS idx_users_oidc_sub ON users(oidc_sub)`,
	}

	for _, stmt := range stmts {
		if _, err := database.ExecContext(context.Background(), stmt); err != nil {
			return fmt.Errorf("migrate sqlite: %w", err)
		}
	}
	return nil
}
