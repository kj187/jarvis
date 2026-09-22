# Jarvis Architecture — Data Model

Part of the architecture reference — start at `.agents/architecture.md` (index). Base rules and critical invariants live in the root `AGENTS.md`; when this file contradicts the code, the code wins.

---

## Go Models (`internal/models/models.go`)

The structs and JSON tags live in `internal/models/models.go` — that file is
the source of truth (an earlier verbatim copy here had already drifted:
`ResolvedAlertsPage` and `AlertHeatmapResponse` were missing). Read the file
for fields; this section keeps only what the code does not say at a glance.
Every model change is mirrored in `frontend/src/types/index.ts` (AGENTS.md →
Workflow Rules #2).

| Type (in `models.go`) | Role / non-obvious facts |
|---|---|
| `EnrichedAlert`, `AlertStatus`, `Receiver` | The alert as served to the browser. `Status.State`: `active` \| `suppressed` \| `unprocessed` \| `resolved`. `ActiveClaim` is set from the claim store, `SeenOn` lists the HA members that reported the fingerprint (omitted for single-member clusters). |
| `ResolvedAlertsPage` | Response of the bounded resolved-history read: `alerts`, `total`, `invalidMatchers` (indices of regexes that did not compile) |
| `Silence`, `SilenceMatcher`, `SilenceStatus` | Alertmanager silence plus `ClusterName`/`AlertmanagerURL`. `Status.State`: `active` \| `pending` \| `expired` |
| `AlertEvent` (+ `EventStatus*`) | One status change. `Status`: `firing` (appeared or active again after a silence) \| `suppressed` (silenced/inhibited) \| `expired` (silence expired/deleted, alert active again) \| `resolved` (gone from the AM API). `EndsAt` is `nil` while firing; `Annotations` is a JSON string. |
| `AlertStats` | Per-fingerprint counters (`OccurrenceCount`, first/last seen, last fired/resolved) |
| `AlertTimelineEntry` | Merged alert + claim + silence history for one alert; `Source`: `alert` \| `claim` \| `silence` |
| `Comment` | `UserID` is set only when auth is enabled (`nil` in mode `none`) |
| `Claim` (+ `ReleaseReason*`) | Release reasons: `manual` \| `resolved` \| `reclaimed` \| `note_updated` |
| `SilenceEvent` | Silence action per alert. Actions actually written: `created`, `updated`, `deleted` (`internal/api/silences.go`) and `created`, `expired` (`internal/history/recorder.go`) — the type's own comment lists only the first three. |
| `SilenceTemplate` | Reusable matcher blueprint, shared across users |
| `ClusterInfo`, `MemberInfo` | Cluster health/count; `Members` only for HA clusters (2+ members); `AlertmanagerURL` is the first member's browser-visible URL |
| `AlertGroup` | `alertname` + `severity` group with its alerts and count |
| `AlertHeatmapResponse` | Raw `firingStarts` timestamps for a lookback `range`; bucketing happens in the frontend (`lib/heatmapUtils.ts`) |
| `WSEvent` + `WSType*` | Envelope `{type, payload}`; the event catalogue with payloads is under "WebSocket Events" in `api.md` |

User types live **outside** `models.go`:

- `internal/users/store.go` — DB `User` (ID, Username, Email, PasswordHash
  (bcrypt, empty for OIDC-only), Role `user|admin`, Provider `internal|oidc`,
  OIDCSub, Groups (IdP groups as of the last SSO login), CreatedAt, LastLoginAt) + `CreateUser`.
- `internal/auth/provider.go` — session `User` (ID, Username, Email, Role,
  Provider) and `ProviderInfo` (mode, loginUrl, setupRequired, authMode,
  runbookBaseUrl — returned by `GET /auth/info`).
- Frontend mirrors: `AuthUser`, `ProviderInfo`, `AdminUser` in
  `frontend/src/types/index.ts`.

---

## Database Schema (`internal/db/migrate_sqlite.go` + `migrate_postgres.go`)

Both dialects are kept in parity. SQLite uses `AUTOINCREMENT` / `datetime('now')`; PostgreSQL uses
`BIGSERIAL` / `now()` and `ADD COLUMN IF NOT EXISTS`. `rebind()` converts `?` → `$N` for PostgreSQL.

```sql
CREATE TABLE IF NOT EXISTS alert_fingerprints (
    fingerprint      TEXT PRIMARY KEY,
    alertname        TEXT NOT NULL,
    cluster_name     TEXT NOT NULL,
    labels           TEXT NOT NULL,     -- JSON
    first_seen_at    DATETIME NOT NULL,
    last_seen_at     DATETIME NOT NULL,
    occurrence_count INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS alert_events (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint      TEXT NOT NULL REFERENCES alert_fingerprints(fingerprint),
    cluster_name     TEXT NOT NULL,
    alertmanager_url TEXT NOT NULL,
    status           TEXT NOT NULL, -- firing | suppressed | expired | resolved
    starts_at        DATETIME NOT NULL,
    ends_at          DATETIME,          -- NULL while firing
    annotations      TEXT,              -- JSON
    recorded_at      DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alert_comments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint  TEXT NOT NULL REFERENCES alert_fingerprints(fingerprint),
    event_id     INTEGER REFERENCES alert_events(id),
    author_name  TEXT NOT NULL,
    body         TEXT NOT NULL,
    created_at   DATETIME NOT NULL DEFAULT (datetime('now')),
    user_id      TEXT,                        -- added via ALTER; NULL in mode "none"
    cluster_name TEXT NOT NULL DEFAULT ''     -- added via ALTER; originating cluster, '' for legacy rows
);

CREATE TABLE IF NOT EXISTS alert_claims (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint    TEXT NOT NULL REFERENCES alert_fingerprints(fingerprint),
    cluster_name   TEXT NOT NULL DEFAULT '',  -- claims scoped per (fingerprint, cluster); '' for legacy rows
    event_id       INTEGER REFERENCES alert_events(id),
    claimed_by     TEXT NOT NULL,
    claimed_at     DATETIME NOT NULL DEFAULT (datetime('now')),
    note           TEXT,
    released_at    DATETIME,
    released_by    TEXT,
    release_reason TEXT  -- manual | resolved | reclaimed | note_updated
);

CREATE TABLE IF NOT EXISTS silence_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint  TEXT NOT NULL,
    silence_id   TEXT NOT NULL,
    cluster_name TEXT NOT NULL,
    action       TEXT NOT NULL,  -- pending | created | updated | deleted | expired
    performed_by TEXT NOT NULL,
    comment      TEXT NOT NULL DEFAULT '',
    recorded_at  DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS silence_templates (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    matchers   TEXT NOT NULL,           -- JSON
    reason     TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    email         TEXT,
    password_hash TEXT,                 -- bcrypt; NULL for OIDC users
    role          TEXT NOT NULL DEFAULT 'user',      -- user | admin
    provider      TEXT NOT NULL DEFAULT 'internal',  -- internal | oidc
    oidc_sub      TEXT UNIQUE,
    oidc_groups   TEXT NOT NULL DEFAULT '[]',  -- JSON array of the IdP groups at the last SSO login (added via ALTER)
    created_at    DATETIME NOT NULL,
    last_login_at DATETIME
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_alert_events_fingerprint          ON alert_events(fingerprint);
CREATE INDEX IF NOT EXISTS idx_alert_events_starts_at            ON alert_events(starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_fingerprint_recorded ON alert_events(fingerprint, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_comments_fingerprint        ON alert_comments(fingerprint);
CREATE INDEX IF NOT EXISTS idx_alert_comments_created_at         ON alert_comments(created_at);
CREATE INDEX IF NOT EXISTS idx_alert_claims_fingerprint          ON alert_claims(fingerprint);
CREATE INDEX IF NOT EXISTS idx_alert_claims_active               ON alert_claims(fingerprint, cluster_name) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alert_claims_released_at          ON alert_claims(released_at) WHERE released_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_silence_events_fingerprint        ON silence_events(fingerprint, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_silence_events_recorded_at        ON silence_events(recorded_at);
CREATE INDEX IF NOT EXISTS idx_alert_fingerprints_last_seen_at   ON alert_fingerprints(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_users_username                    ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_oidc_sub                    ON users(oidc_sub);

-- PostgreSQL only (docs/postgres-ha.md, snapshot distribution) — SQLite never creates or
-- reads this table (single replica, no followers to feed).
CREATE TABLE IF NOT EXISTS poll_snapshots (
    cluster_name TEXT PRIMARY KEY,
    payload      BYTEA NOT NULL,
    taken_at     TIMESTAMPTZ NOT NULL
);

-- One row per authenticated user with at least one non-default setting.
-- `settings` is an opaque JSON blob (internal/settings, `internal/api/settings_handler.go`)
-- — the backend never inspects individual keys, so a new frontend setting
-- never requires a migration. ON DELETE CASCADE removes it when the user is
-- deleted (admin panel). Not leader-gated, no fanout, no cache (see "API Endpoints" in `api.md`).
CREATE TABLE IF NOT EXISTS user_settings (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings   TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT (datetime('now'))  -- TIMESTAMPTZ NOT NULL DEFAULT NOW() on PostgreSQL
);

-- One row per admin-settings "section" (`internal/globalsettings`,
-- `internal/api/admin_settings_handler.go`). `value` is opaque JSON like
-- `user_settings.settings` above — this package never inspects a section's
-- shape, only whoever registers the section (via `Store.Register`) does.
-- Phase 0 of the RBAC label-scoped-access plan registers no section at all;
-- a later phase (e.g. an "access" rule list) is the first real consumer.
-- `updated_by` is the acting admin's username, empty for an anonymous caller
-- (cannot happen in practice — the API is behind RequireAdmin).
CREATE TABLE IF NOT EXISTS global_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT (datetime('now')),  -- TIMESTAMPTZ NOT NULL DEFAULT NOW() on PostgreSQL
    updated_by TEXT NOT NULL DEFAULT ''
);
```

The four `*_created_at`/`*_released_at`/`*_recorded_at`/`*_last_seen_at` indices
back the retention sweeps in `store_retention.go`
(`DeleteCommentsBefore`/`DeleteReleasedClaimsBefore`/`DeleteSilenceEventsBefore`/
`DeleteOrphanFingerprintsBefore`): each of those filtered a column with no
index, or one whose leading column didn't match the filter, forcing a full
table scan per sweep — confirmed via `EXPLAIN (ANALYZE, BUFFERS)` against a
seeded local PostgreSQL instance (bitmap/plain index scan afterwards). A
composite `(fingerprint, cluster_name, id)` index was also evaluated for the
"latest event per (fingerprint, cluster_name)" CTE in
`GetAllResolved`/`VisitResolved` (`internal/history/store.go`,
`store_resolved.go`) but deliberately **not** added: that CTE aggregates over
the unfiltered whole `alert_events` table, and PostgreSQL never chose an
index for it even at 660k rows (a full-table `MAX(id) GROUP BY` has to touch
every row regardless, and a seq scan + hash aggregate is cheaper there than a
b-tree of the same size) — the index would be pure write overhead. The
actual fix is pushing `fingerprint`/`cluster_name`/the `After` lower bound
into that CTE (the `Through` upper bound must stay outer, or it breaks the
"excludes re-fired alerts" guarantee, Critical Invariant #2/#17) — a query-
semantics change against a tested invariant, left for a separate PR.

**SQLite settings** (on open): `SetMaxOpenConns(1)`, `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`, `PRAGMA busy_timeout=5000`. PostgreSQL uses a capped pool: `JARVIS_DB_MAX_OPEN_CONNS` (default 10) sets MaxOpen **and** MaxIdle (so bursts reuse connections instead of churning them), plus `ConnMaxLifetime=30m` / `ConnMaxIdleTime=5m` — never unbounded, never `SetMaxOpenConns(1)` (Critical Invariant #8).
