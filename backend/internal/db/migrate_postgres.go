package db

import (
	"context"
	"database/sql"
	"fmt"
)

// migrationLockClassID/migrationLockID identify a session-level advisory
// lock distinct from the leader-election lock (docs/postgres-ha.md,
// "Leader election": leader.LockClassID/LockID = 0x4A525653/1): every pod
// runs Migrate() on startup, before leader election even begins, so
// without a lock two pods racing `CREATE TABLE IF NOT EXISTS` concurrently
// can both lose the race to PostgreSQL's own catalog uniqueness check and
// crash with "duplicate key value violates unique constraint
// \"pg_type_typname_nsp_index\"" — a CrashLoopBackOff on every rolling
// deploy.
const (
	migrationLockClassID int32 = 0x4A525653 // "JRVS" — same class as leader election
	migrationLockID      int32 = 2          // distinct from leader.LockID (1)
)

func migratePostgres(database *sql.DB) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS alert_fingerprints (
			fingerprint      TEXT PRIMARY KEY,
			alertname        TEXT NOT NULL,
			cluster_name     TEXT NOT NULL,
			labels           TEXT NOT NULL,
			first_seen_at    TIMESTAMPTZ NOT NULL,
			last_seen_at     TIMESTAMPTZ NOT NULL,
			occurrence_count INTEGER DEFAULT 1
		)`,
		`CREATE TABLE IF NOT EXISTS alert_events (
			id               BIGSERIAL PRIMARY KEY,
			fingerprint      TEXT NOT NULL REFERENCES alert_fingerprints(fingerprint),
			cluster_name     TEXT NOT NULL,
			alertmanager_url TEXT NOT NULL,
			status           TEXT NOT NULL,
			starts_at        TIMESTAMPTZ NOT NULL,
			ends_at          TIMESTAMPTZ,
			annotations      TEXT,
			recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS alert_comments (
			id           BIGSERIAL PRIMARY KEY,
			fingerprint  TEXT NOT NULL REFERENCES alert_fingerprints(fingerprint),
			event_id     BIGINT REFERENCES alert_events(id),
			author_name  TEXT NOT NULL,
			body         TEXT NOT NULL,
			created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS alert_claims (
			id             BIGSERIAL PRIMARY KEY,
			fingerprint    TEXT NOT NULL REFERENCES alert_fingerprints(fingerprint),
			cluster_name   TEXT NOT NULL DEFAULT '',
			event_id       BIGINT REFERENCES alert_events(id),
			claimed_by     TEXT NOT NULL,
			claimed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			note           TEXT,
			released_at    TIMESTAMPTZ,
			released_by    TEXT,
			release_reason TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS silence_events (
			id           BIGSERIAL PRIMARY KEY,
			fingerprint  TEXT NOT NULL,
			silence_id   TEXT NOT NULL,
			cluster_name TEXT NOT NULL,
			action       TEXT NOT NULL,
			performed_by TEXT NOT NULL,
			comment      TEXT NOT NULL DEFAULT '',
			recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS silence_templates (
			id         TEXT PRIMARY KEY,
			name       TEXT NOT NULL UNIQUE,
			matchers   TEXT NOT NULL,
			reason     TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_alert_events_fingerprint ON alert_events(fingerprint)`,
		`CREATE INDEX IF NOT EXISTS idx_alert_events_starts_at   ON alert_events(starts_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_alert_events_fingerprint_recorded ON alert_events(fingerprint, recorded_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_alert_comments_fingerprint ON alert_comments(fingerprint)`,
		`CREATE INDEX IF NOT EXISTS idx_alert_claims_fingerprint ON alert_claims(fingerprint)`,
		`CREATE INDEX IF NOT EXISTS idx_alert_claims_active      ON alert_claims(fingerprint, cluster_name) WHERE released_at IS NULL`,
		`CREATE INDEX IF NOT EXISTS idx_silence_events_fingerprint ON silence_events(fingerprint, recorded_at DESC)`,
		`CREATE TABLE IF NOT EXISTS users (
			id             TEXT PRIMARY KEY,
			username       TEXT NOT NULL UNIQUE,
			email          TEXT,
			password_hash  TEXT,
			role           TEXT NOT NULL DEFAULT 'user',
			provider       TEXT NOT NULL DEFAULT 'internal',
			oidc_sub       TEXT UNIQUE,
			created_at     TIMESTAMPTZ NOT NULL,
			last_login_at  TIMESTAMPTZ
		)`,
		`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`,
		`CREATE INDEX IF NOT EXISTS idx_users_oidc_sub ON users(oidc_sub)`,
		// Add user_id column to alert_comments (nullable, for ownership checks by ID).
		`ALTER TABLE alert_comments ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id)`,
		// Store originating alert cluster for each comment (legacy rows default to '').
		`ALTER TABLE alert_comments ADD COLUMN IF NOT EXISTS cluster_name TEXT NOT NULL DEFAULT ''`,
		// Add cluster_name to alert_claims so claims are scoped per (fingerprint, cluster).
		`ALTER TABLE alert_claims ADD COLUMN IF NOT EXISTS cluster_name TEXT NOT NULL DEFAULT ''`,
		// poll_snapshots: leader-only poll-snapshot distribution to followers
		// (docs/postgres-ha.md D3). PostgreSQL only — SQLite never
		// reads or writes this table (single replica, no followers to feed).
		`CREATE TABLE IF NOT EXISTS poll_snapshots (
			cluster_name TEXT PRIMARY KEY,
			payload      BYTEA NOT NULL,
			taken_at     TIMESTAMPTZ NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS user_settings (
			user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			settings   TEXT NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
	}

	// Session-level locks require a single dedicated connection: they are
	// held by the backend session, not a transaction, and must be released
	// on that same connection.
	ctx := context.Background()
	conn, err := database.Conn(ctx)
	if err != nil {
		return fmt.Errorf("migrate postgres: acquire connection: %w", err)
	}
	defer func() { _ = conn.Close() }()

	if _, err := conn.ExecContext(ctx, `SELECT pg_advisory_lock($1, $2)`, migrationLockClassID, migrationLockID); err != nil {
		return fmt.Errorf("migrate postgres: acquire migration lock: %w", err)
	}
	defer func() {
		// Best-effort: the connection close above also releases session
		// locks, but explicit unlock keeps the lock's lifetime observable
		// in pg_locks for the duration of this function only.
		_, _ = conn.ExecContext(context.Background(), `SELECT pg_advisory_unlock($1, $2)`, migrationLockClassID, migrationLockID)
	}()

	for _, stmt := range stmts {
		if _, err := conn.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("migrate postgres: %w", err)
		}
	}
	return nil
}
