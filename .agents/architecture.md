# Jarvis — Full Architecture Reference

Load this file for deep feature work, refactoring, new API endpoints, and any
task that requires full context about the data model, API, stores, or state
transitions. Base rules and critical invariants live in the root `AGENTS.md`.

---

## Technology Decisions

| Decision | Why |
|---|---|
| `modernc.org/sqlite` + `pgx/v5` | Both are pure Go — no C compiler needed in container build (Podman/distroless) |
| `JARVIS_DB_DSN` selects dialect | Prefix `postgres://` → PostgreSQL via `pgx/v5/stdlib`; anything else → SQLite file path |
| No CGO | Container build with `CGO_ENABLED=0`, distroless final image has no C runtime |
| `//go:build prod` tag | `embed.FS` cannot compile a non-existent `dist/` directory — two files (prod/!prod) instead of one |
| TanStack Query WS patching | WS events patch the cache directly (`setQueryData`) — no extra refetch round-trip |
| Zustand v5 with `persist` | `viewMode` + `filters` persisted in localStorage, but URL params take precedence |

---

## Go Models (`internal/models/models.go`)

```go
// ── Alert ───────────────────────────────────────────────────────────────────
type AlertStatus struct {
    InhibitedBy []string `json:"inhibitedBy"`
    SilencedBy  []string `json:"silencedBy"`
    State       string   `json:"state"` // active | suppressed | unprocessed | resolved
}
type Receiver struct{ Name string `json:"name"` }
type EnrichedAlert struct {
    Fingerprint     string            `json:"fingerprint"`
    Status          AlertStatus       `json:"status"`
    Labels          map[string]string `json:"labels"`
    Annotations     map[string]string `json:"annotations"`
    StartsAt        time.Time         `json:"startsAt"`
    EndsAt          time.Time         `json:"endsAt"`
    UpdatedAt       time.Time         `json:"updatedAt"`
    GeneratorURL    string            `json:"generatorURL"`
    Receivers       []Receiver        `json:"receivers"`
    ClusterName     string            `json:"clusterName"`
    AlertmanagerURL string            `json:"alertmanagerUrl"`
    ActiveClaim     *Claim            `json:"activeClaim,omitempty"`
    SeenOn          []string          `json:"seenOn,omitempty"` // HA member names that reported this fingerprint; omitted for single-member clusters
}

// ── Silence ──────────────────────────────────────────────────────────────────
type SilenceMatcher struct {
    IsEqual bool   `json:"isEqual"`
    IsRegex bool   `json:"isRegex"`
    Name    string `json:"name"`
    Value   string `json:"value"`
}
type SilenceStatus struct{ State string `json:"state"` } // active | pending | expired
type Silence struct {
    ID              string           `json:"id"`
    Matchers        []SilenceMatcher `json:"matchers"`
    StartsAt        time.Time        `json:"startsAt"`
    EndsAt          time.Time        `json:"endsAt"`
    CreatedBy       string           `json:"createdBy"`
    Comment         string           `json:"comment"`
    Status          SilenceStatus    `json:"status"`
    UpdatedAt       time.Time        `json:"updatedAt"`
    ClusterName     string           `json:"clusterName"`
    AlertmanagerURL string           `json:"alertmanagerUrl"`
}

// ── History ──────────────────────────────────────────────────────────────────
// Status: firing | suppressed | expired | resolved
type AlertEvent struct {
    ID              int64      `json:"id"`
    Fingerprint     string     `json:"fingerprint"`
    ClusterName     string     `json:"clusterName"`
    AlertmanagerURL string     `json:"alertmanagerUrl"`
    Status          string     `json:"status"`
    StartsAt        time.Time  `json:"startsAt"`
    EndsAt          *time.Time `json:"endsAt"` // nil while firing
    Annotations     string     `json:"annotations"` // JSON
    RecordedAt      time.Time  `json:"recordedAt"`
}
type AlertStats struct {
    Fingerprint     string     `json:"fingerprint"`
    Alertname       string     `json:"alertname"`
    ClusterName     string     `json:"clusterName"`
    FirstSeenAt     time.Time  `json:"firstSeenAt"`
    LastSeenAt      time.Time  `json:"lastSeenAt"`
    LastFiredAt     *time.Time `json:"lastFiredAt,omitempty"`
    LastResolvedAt  *time.Time `json:"lastResolvedAt,omitempty"`
    OccurrenceCount int        `json:"occurrenceCount"`
}

// ── Timeline (merged alert + claim + silence history per alert) ───────────────
type AlertTimelineEntry struct {
    Source     string    `json:"source"` // alert | claim | silence
    SourceID   int64     `json:"sourceId"`
    RecordedAt time.Time `json:"recordedAt"`
    Who        string    `json:"who"`
    Action     string    `json:"action"`
    Comment    string    `json:"comment,omitempty"`
    SilenceID  string    `json:"silenceId,omitempty"`
}

// ── Comment ───────────────────────────────────────────────────────────────────
type Comment struct {
    ID          int64     `json:"id"`
    Fingerprint string    `json:"fingerprint"`
    ClusterName string    `json:"clusterName,omitempty"`
    EventID     *int64    `json:"eventId,omitempty"`
    UserID      *string   `json:"userId,omitempty"`   // set when auth enabled; nil for mode "none"
    AuthorName  string    `json:"authorName"`
    Body        string    `json:"body"`
    CreatedAt   time.Time `json:"createdAt"`
}

// ── Claim ─────────────────────────────────────────────────────────────────────
// Release reasons: manual | resolved | reclaimed | note_updated
type Claim struct {
    ID            int64      `json:"id"`
    Fingerprint   string     `json:"fingerprint"`
    ClusterName   string     `json:"clusterName"`
    EventID       *int64     `json:"eventId,omitempty"`
    ClaimedBy     string     `json:"claimedBy"`
    ClaimedAt     time.Time  `json:"claimedAt"`
    Note          string     `json:"note,omitempty"`
    ReleasedAt    *time.Time `json:"releasedAt,omitempty"`
    ReleasedBy    string     `json:"releasedBy,omitempty"`
    ReleaseReason string     `json:"releaseReason,omitempty"`
}

// ── WebSocket Events ──────────────────────────────────────────────────────────
type WSEvent struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"`
}
const (
    WSTypeAlertsUpdate  = "alerts_update"   // payload: { alerts: EnrichedAlert[] }
    WSTypeClaimSet      = "claim_set"        // payload: { fingerprint, clusterName, claim }
    WSTypeClaimReleased = "claim_released"   // payload: { fingerprint, clusterName, releasedBy }
    WSTypeCommentAdded  = "comment_added"    // payload: { fingerprint, comment }
)

// ── SilenceEvent (history of silence actions per alert) ───────────────────────
// Action: pending | created | updated | deleted | expired
type SilenceEvent struct {
    ID          int64     `json:"id"`
    Fingerprint string    `json:"fingerprint"`
    SilenceID   string    `json:"silenceId"`
    ClusterName string    `json:"clusterName"`
    Action      string    `json:"action"`
    PerformedBy string    `json:"performedBy"`
    Comment     string    `json:"comment"`
    RecordedAt  time.Time `json:"recordedAt"`
}

// ── SilenceTemplate (reusable matcher blueprint, shared across users) ─────────
type SilenceTemplate struct {
    ID        string           `json:"id"`
    Name      string           `json:"name"`
    Matchers  []SilenceMatcher `json:"matchers"`
    Reason    string           `json:"reason"`
    CreatedAt time.Time        `json:"createdAt"`
}

// ── Cluster ───────────────────────────────────────────────────────────────────
type ClusterInfo struct {
    Name            string       `json:"name"`
    AlertmanagerURL string       `json:"alertmanagerUrl"` // first member's browser-visible URL
    PrometheusURL   string       `json:"prometheusUrl"`
    Healthy         bool         `json:"healthy"` // true when >=1 member is up
    AlertCount      int          `json:"alertCount"`
    Members         []MemberInfo `json:"members,omitempty"` // HA clusters only (2+ members); omitted for single-member clusters
}
type MemberInfo struct {
    Name    string `json:"name"` // host:port
    URL     string `json:"url"`  // browser-visible URL (HOST_ALIAS-rewritten)
    Healthy bool   `json:"healthy"`
}

// ── AlertGroup ────────────────────────────────────────────────────────────────
type AlertGroup struct {
    Alertname string          `json:"alertname"`
    Severity  string          `json:"severity"`
    Alerts    []EnrichedAlert `json:"alerts"`
    Count     int             `json:"count"`
}
```

User types live **outside** `models.go`:

- `internal/users/store.go` — DB `User` (ID, Username, Email, PasswordHash
  (bcrypt, empty for OIDC-only), Role `user|admin`, Provider `internal|oidc`,
  OIDCSub, CreatedAt, LastLoginAt) + `CreateUser`.
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
    created_at    DATETIME NOT NULL,
    last_login_at DATETIME
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_alert_events_fingerprint          ON alert_events(fingerprint);
CREATE INDEX IF NOT EXISTS idx_alert_events_starts_at            ON alert_events(starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_fingerprint_recorded ON alert_events(fingerprint, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_comments_fingerprint        ON alert_comments(fingerprint);
CREATE INDEX IF NOT EXISTS idx_alert_claims_fingerprint          ON alert_claims(fingerprint);
CREATE INDEX IF NOT EXISTS idx_alert_claims_active               ON alert_claims(fingerprint, cluster_name) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_silence_events_fingerprint        ON silence_events(fingerprint, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_username                    ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_oidc_sub                    ON users(oidc_sub);
```

**SQLite settings** (on open): `SetMaxOpenConns(1)`, `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`, `PRAGMA busy_timeout=5000`. PostgreSQL uses the default pool (no `SetMaxOpenConns(1)`).

---

## API Endpoints

Auth column: **None** = public · **Auth** = `RequireAuth` (valid JWT) · **Admin** = `RequireAdmin` (role=admin).
When `JARVIS_AUTH_MODE=full_protect`, **all** `/api/v1/*` routes additionally require auth (the `full_protect?`
marker below). Write routes are rate-limited (`writeRL` = 30/min, burst 10); `/poll` is limited to 1 req/5s
(relaxed in `-tags e2e` builds).

**Cluster scoping**: all `/alerts/:fingerprint/*` routes accept `?cluster=<name>` —
the same fingerprint can exist in multiple clusters, so history, stats, comments,
and claims are isolated per cluster. Frontend hooks pass `clusterName` accordingly.

Global middleware (all responses): `Secure` headers (X-XSS-Protection, nosniff,
X-Frame-Options SAMEORIGIN, HSTS, CSP `default-src 'self'; …`), body limit 1 MB,
CORS from `JARVIS_ALLOWED_ORIGINS` (credentials allowed).

```
# ── Health / Metrics / Auth / Setup ──────────────────────────────────────────
GET    /health                                   None        → { status: "ok" }
GET    /metrics                                  None        → Prometheus exposition format (see internal/metrics below)
GET    /auth/info                                None        → { mode, loginUrl, setupRequired, runbookBaseUrl }
POST   /auth/login                               None  (RL)  Body: { username, password } → user + Set-Cookie
POST   /auth/logout                              None        → clears session cookie
GET    /auth/me                                  Auth        → User
GET    /auth/oidc/start                          None        → 302 redirect to OIDC issuer (PKCE)
GET    /auth/oidc/callback                       None        → exchanges code, sets cookie, 302 → /
POST   /setup                                    None  (RL)  Body: { username, password } (internal mode only; 403 if users exist)

# ── WebSocket ────────────────────────────────────────────────────────────────
WS     /ws                                       None        (origin checked against JARVIS_ALLOWED_ORIGINS)

# ── Status / Version ─────────────────────────────────────────────────────────
GET    /api/v1/status                            full_protect?  → { status, clusters, alerts, ws_clients }
GET    /api/v1/info                              full_protect?  → { version }

# ── Alerts (in-memory AlertStore) ────────────────────────────────────────────
GET    /api/v1/alerts/groups                     full_protect?  → []AlertGroup   ← register BEFORE :fingerprint/*!
GET    /api/v1/alerts                            full_protect?  → []EnrichedAlert  ?cluster= ?severity= ?state=

# ── Alert details (history store / DB) ───────────────────────────────────────
GET    /api/v1/alerts/:fingerprint/history       full_protect?  → { events: AlertEvent[], total }  ?limit= ?offset= ?cluster=
GET    /api/v1/alerts/:fingerprint/timeline      full_protect?  → []AlertTimelineEntry  (merged alert+claim+silence history)
GET    /api/v1/alerts/:fingerprint/stats         full_protect?  → AlertStats  ?cluster=
GET    /api/v1/alerts/:fingerprint/silence-events full_protect? → []SilenceEvent   (silence action timeline)

# ── Comments ─────────────────────────────────────────────────────────────────
GET    /api/v1/alerts/:fingerprint/comments      full_protect?  → []Comment
POST   /api/v1/alerts/:fingerprint/comments      Auth  (write)  Body: { authorName, body, eventId? }
DELETE /api/v1/alerts/:fingerprint/comments/:id  Auth  (write)  (author-gated: user_id, else author_name)

# ── Claims ───────────────────────────────────────────────────────────────────
GET    /api/v1/alerts/:fingerprint/claim         full_protect?  → Claim | null  ?cluster=
POST   /api/v1/alerts/:fingerprint/claim         Auth  (write)  Body: { claimedBy, note?, eventId? }
PATCH  /api/v1/alerts/:fingerprint/claim/note    Auth  (write)  Body: { note }  (edit note of active claim)
DELETE /api/v1/alerts/:fingerprint/claim         Auth  (write)  ?by=username
GET    /api/v1/alerts/:fingerprint/claims/history full_protect? → []Claim  ?cluster=

# ── Silences (proxy → Alertmanager) ──────────────────────────────────────────
GET    /api/v1/silences                          full_protect?  → []Silence  ?cluster=
POST   /api/v1/silences                          Auth  (write)  → { id }
#        validated server-side before the AM call (silence_validation.go validateSilenceMatchers):
#        ≥1 matcher, no empty matcher names, every regex must compile (Go regexp = RE2, same
#        engine as AM — accepts syntax like `(?i)` that a browser's JS RegExp rejects), ≥1 matcher
#        must not match the empty string, endsAt > startsAt, endsAt > now
#        AM 4xx response (e.g. its own validation rejection) → relayed as 400 with a sanitized
#        message (sanitizeAMMessage); AM 5xx/transport failure → generic 502
#        id set → update (AM may return a NEW id; the old silence is then expired to avoid duplicates)
#        fingerprint set → SilenceEvent recorded (action: created | updated | pending when startsAt is in the future)
#        when auth mode ≠ none: createdBy/performedBy forced to the session username
DELETE /api/v1/silences/:id                      Auth  (write)  ?cluster= (required) &fingerprint= &by=  → records "deleted" event
#        AM 4xx response → relayed as 400 (sanitized); AM 5xx/transport failure → generic 502

# ── Silence Templates (DB, shared) ───────────────────────────────────────────
GET    /api/v1/silence-templates                 full_protect?  → []SilenceTemplate
POST   /api/v1/silence-templates                 Auth  (write)  Body: { name, matchers[], reason? }  — validateSilenceMatchers applies
PUT    /api/v1/silence-templates/:id             Auth  (write)  Body: { name, matchers[], reason? }  — validateSilenceMatchers applies
DELETE /api/v1/silence-templates/:id             Auth  (write)

# ── Poll / Clusters ──────────────────────────────────────────────────────────
POST   /api/v1/poll                              None  (RL)   → triggers an immediate Alertmanager poll
GET    /api/v1/clusters                          full_protect?  → []ClusterInfo

# ── Admin (auth + role=admin) ────────────────────────────────────────────────
GET    /api/v1/admin/users                       Admin        → []User
POST   /api/v1/admin/users                       Admin (RL)   Body: { username, password, role }
PATCH  /api/v1/admin/users/:id                   Admin        Body: { role }  (cannot change own role)
DELETE /api/v1/admin/users/:id                   Admin        (cannot delete self)

# ── E2E test routes (only with -tags e2e; no-op in production builds) ────────
POST   /api/v1/test/reset                        (e2e only)  truncate history tables + clear in-memory store
POST   /api/v1/test/seed                         (e2e only)  insert resolved-alert lifecycles
POST   /api/v1/test/claim                        (e2e only)  set claim, bypasses auth
POST   /api/v1/test/comment                      (e2e only)  add comment, bypasses auth (no WS broadcast)

# ── Static (production build tag only) ───────────────────────────────────────
GET    /*                                         None        → embed.FS (Vite build); SPA fallback to index.html
                                                              firstRunRedirect → /setup when internal mode + no users
```

---

## Metrics (`internal/metrics`)

Prometheus metrics on an injected `*prometheus.Registry` (never the global
default one — that would panic on duplicate registration across parallel Go
tests). `metrics.New(version)` builds it, including the standard Go/process
collectors and `jarvis_build_info`. `Metrics.Handler()` serves `GET /metrics`.

- `collector.go` — `storeCollector` (`prometheus.Collector`): computes
  `jarvis_alerts`, `jarvis_alerts_by_severity`, `jarvis_ws_clients`,
  `jarvis_clusters_configured`, and `jarvis_alertmanager_up` (labeled
  `cluster`, `member`) at scrape time from the in-memory `AlertStore`, the WS
  `Hub`, and the recorder's cached `ClusterUpStates() map[string]map[string]bool`
  (cluster → member → up, sourced from each `cluster.Cluster.MemberUpStates()`)
  — `Collect()` never makes an upstream HTTP call itself.
- `echo.go` — `Metrics.EchoMiddleware()`: records `jarvis_http_requests_total`
  / `jarvis_http_request_duration_seconds`, labeled by Echo route pattern
  (`c.Path()`, never the raw URL) to keep cardinality bounded. Skips
  `/metrics`, `/health`, `/ws`.
- Event counters `jarvis_poll_cycles_total`, `jarvis_poll_errors_total`,
  `jarvis_poll_duration_seconds`, `jarvis_cluster_fetch_duration_seconds`,
  `jarvis_alert_events_total` live on `history.Recorder`;
  `jarvis_ws_broadcasts_total` lives on `ws.Hub`. Both
  `history.NewRecorder(...)` and `ws.NewHub(...)` take a trailing
  `*metrics.Metrics` argument that is nil-safe (same pattern as the existing
  `pollTrigger` nil-check in `triggerPoll`) — most tests construct the
  Recorder/Hub via other paths and don't need to pass one.
- Every metric that can meaningfully be attributed to one Alertmanager cluster
  carries a `cluster` label (`jarvis_poll_cycles_total`, `_errors_total`,
  `_alert_events_total`, `jarvis_alerts*`). `jarvis_alertmanager_up` and
  `jarvis_cluster_fetch_duration_seconds` additionally carry a `member` label
  (HA-cluster support) — single-member clusters emit their one member, so
  existing `sum by (cluster) (...)` queries are unaffected; only queries
  asserting the exact label set need updating (see `docs/metrics.md`).
  `jarvis_poll_duration_seconds` is the one deliberate exception with no
  per-cluster label — it measures the *whole* poll cycle (all clusters in
  parallel + the shared DB write in `applyPollResults`), so a per-cluster
  label would misrepresent it; `jarvis_cluster_fetch_duration_seconds` is the
  per-member counterpart for isolating a slow upstream Alertmanager member.
- Full metric reference for operators: `docs/metrics.md`.

---

## Frontend Component Tree (`frontend/src/`)

```
main.tsx              → ReactDOM.createRoot, QueryClient (staleTime 10s, retry 2), authStore.hydrate(), App
App.tsx               → auth-gated shell: SetupPage / LoginPage (full_protect) / RootLayout; applies theme + default filters
├── api/client.ts     → All fetch wrappers (alerts, silences, templates, claims, comments, auth, admin, poll, clusters)
├── store/
│   ├── uiStore.ts            → Zustand+persist('jarvis-ui'): nav page, view modes, filters, fullscreen, counts
│   ├── authStore.ts          → user, providerInfo, hydrate() (retries on slow backend), login/logout
│   └── useSettingsStore.ts   → Zustand+persist('jarvis-user-settings'): all user preferences
├── types/index.ts    → Alert, Silence, Claim, Comment, AlertEvent, AlertStats, SilenceEvent,
│                        SilenceTemplate, LabelMatcher, AuthUser, ProviderInfo, AdminUser, ...
├── hooks/
│   ├── useAlerts.ts           → useAlerts, useAlertGroups, useAlertHistory, useAlertTimeline,
│   │                            useAlertStats, useRefreshAlerts
│   ├── useAlertCounts.ts      → per-state alert counts for nav badges
│   ├── useAlertComments.ts    → useAlertComments, useAddComment, useDeleteComment (all cluster-scoped)
│   ├── useAlertClaim.ts       → useActiveClaim, useClaimHistory, useSetClaim, useReleaseClaim,
│   │                            useUpdateClaimNote, useClaimController (all cluster-scoped); USERNAME_KEY
│   ├── useSilences.ts         → useSilences, useSilenceEvents, useUpsertSilence, useDeleteSilence,
│   │                            useAckAlert (one-click Fast-Silence → short-lived exact-match silence),
│   │                            resolveCreatorName
│   ├── useSilenceTemplates.ts → list + create/update/delete template mutations
│   ├── useWebSocket.ts        → WS connection + cache patching via handleEvent()
│   ├── useProtectedAction.ts  → wraps write actions; opens LoginModal when auth required
│   ├── useLoginGuard.ts       → login-required state for guarded UI elements
│   ├── useFormatTime.ts       → relative/absolute timestamp formatter (from settings)
│   └── useVersion.ts          → app version (staleTime Infinity)
├── lib/
│   ├── alertUtils.ts          → getFilterableLabels, matchesLabelMatchers (filter-bar only,
│   │                            substring regex + pseudo-labels — never for silence matching),
│   │                            safeRegex, anchoredRegex, silenceWouldMatchAlert (Alertmanager-exact:
│   │                            anchored regex, real labels only — SilenceForm preview/overlap),
│   │                            hasUnevaluableRegexMatcher, silenceMatchesAlert,
│   │                            getEffectiveAlertState, getSilenceState (both consider ALL active
│   │                            silences in silencedBy, not just the first), getExpiredSilence,
│   │                            filterSilences, pickIdentifierLabel, formatSilenceDuration,
│   │                            formatTime, severityOrder, formatAckDuration, buildAckSilenceBody,
│   │                            computeGroupLabelValues (only labels present on EVERY alert in the
│   │                            group — a partial label is dropped, never partially OR-matched),
│   │                            buildGroupAckSilenceBody (throws on multi-cluster input),
│   │                            escapeRegexValue, unescapeRegex, isRoundTrippableTagList (detects
│   │                            whether an AM regex matcher is a Jarvis-style escaped-literal-OR-list
│   │                            SilenceForm can safely edit as tags, vs. a real regex needing raw-text
│   │                            editing — see SilenceForm's `raw` matcher mode),
│   │                            FAST_SILENCE_DURATIONS, HIDDEN_LABEL_KEYS, labelColorStyle
│   │                            ← single source, never duplicate in components
│   │                            100% test coverage enforced (frontend/vitest.config.ts) — a narrow
│   │                            exception to the functional-E2E-only strategy, see .agents/testing.md
│   ├── alertSelection.ts      → makeAlertSelectionKey / parseAlertSelectionKey — selection key
│   │                            format `<cluster>::<fingerprint>` (URL `alert=` param, cluster-safe)
│   ├── linkUtils.tsx          → isUrl, extractLinkButtons (URL-valued labels/annotations + runbook
│   │                            logic), renderTextWithLinks
│   └── utils.ts               → cn(), formatDuration() + misc helpers
└── components/
    ├── ui/                    → shadcn/ui: button, card, badge, dialog, sheet, select, input,
    │                            textarea, date-time-picker, tooltip, truncatable-chip
    ├── layout/
    │   ├── Header.tsx         → nav tabs, cluster status, WS indicator, polling/refresh, theme,
    │   │                        settings, create-silence, login/user-menu, mobile hamburger
    │   └── MatcherChipsBar.tsx → chip-based label filter (=, !=, =~, !~), tag multi-value,
    │                            suggestions, locked default-filter chips
    ├── alerts/
    │   ├── AlertsPage.tsx     → useWebSocket, filter/search, card|list + detail panel, fullscreen, pagination
    │   ├── AlertCardGrid.tsx  → grouped by settings `groupByLabel` (default severity), responsive
    │   │                        column binning, per-group pagination, drag-and-drop section
    │   │                        reordering (persisted: 'jarvis-card-section-order:<label>')
    │   ├── AlertCard.tsx      → card + claim banner + count badge + silence/detail actions + Fast-Silence (hover)
    │   ├── AlertListView.tsx  → sortable table (name/time), expandable groups, section
    │   │                        reordering (persisted: 'jarvis-list-section-order:<label>')
    │   ├── AlertListRow.tsx   → single/indented row
    │   ├── AlertDetailPanel.tsx → slide-over: labels/annotations + link buttons, stats & timeline,
    │   │                          claim (useClaimController), comments, silence controls + Fast-Silence, AI-prompt section
    │   ├── AlertDetailSection.tsx → collapsible section wrapper used inside the detail panel
    │   ├── AlertDetailHistorySection.tsx → stats + merged event timeline section
    │   ├── AlertComments.tsx  → comment list + input (author-gated delete)
    │   ├── AckButton.tsx      → one-click Fast-Silence (short-lived exact-match silence); active-only
    │   │                        (getEffectiveAlertState), auth-gated (useProtectedAction); hover/focus
    │   │                        popover menu (FAST_SILENCE_DURATIONS 30m/1h/4h/1d/1w) picks the duration;
    │   │                        transient Silenced/Failed feedback; used by AlertCard + AlertDetailPanel
    │   ├── AlertBadge.tsx     → severity badge
    │   ├── AlertFilters.tsx   → label matcher chips + state dropdown
    │   ├── LabelChip.tsx      → label chip with hover operator dropdown
    │   ├── ViewToggle.tsx     → ⊞ / ☰ toggle
    │   └── EmptyState.tsx     → large empty-state icon (no alerts)
    ├── silences/
    │   ├── SilencesPage.tsx   → dedicated page: card|list, fullscreen, show/hide expired,
    │   │                        sort (expires/created), matcher-chip filter
    │   ├── SilenceCard.tsx    → status, matchers, expiry, expired info box, re-create
    │   ├── SilenceGroupCard.tsx → grouped identical silences (count + summed affected)
    │   ├── SilenceListView.tsx → table view
    │   ├── SilenceExpiry.tsx  → "expired X ago" / "expires in X" / "starts in X"
    │   ├── SilenceExpireModal.tsx → expire/extend confirmation (silence-ID link → AM)
    │   ├── SilenceForm.tsx    → 3 steps: form (matchers, clusters, duration, live match count,
    │   │                        overlap/zero-match/unevaluable-regex warnings) → preview → per-cluster results
    │   │                        Regex matchers whose AM value isn't a literal-tag-OR-list
    │   │                        (`isRoundTrippableTagList`) load in raw-text mode (`SilenceMatcher.raw`)
    │   │                        instead of the tag editor, and submit verbatim — editing a real regex
    │   │                        as tags would corrupt it on save
    │   ├── MatcherEditor.tsx  → matcher rows: operators + tag multi-value + suggestions
    │   └── SilenceTemplateTab.tsx → template CRUD + apply-to-form
    ├── settings/
    │   └── SettingsSheet.tsx  → time format, default view, resolved page size, default filters,
    │                            default silence duration, creator name, poll interval, claim animation, theme
    ├── auth/
    │   ├── LoginModal.tsx     → on-demand login (write_protect)
    │   ├── LoginPage.tsx      → full-page login (full_protect)
    │   ├── NoAuthNotice.tsx   → banner in mode "none" (dismiss persisted)
    │   └── SetupPage.tsx      → first-run admin creation
    └── admin/
        └── UserManagement.tsx → user table, add user, change role, delete (confirm), "(you)" badge
```

---

## `uiStore` Interface (persisted under `jarvis-ui`)

```typescript
type ViewMode = 'card' | 'list'
type ActivePage = 'alerts' | 'silences'

interface UIStore {
  activePage: ActivePage                       // current nav tab
  viewMode: ViewMode                           // alerts view (legacy key 'jarvis-viewMode')
  activeViewMode: ViewMode                      // active-tab view (key 'jarvis-activeViewMode')
  silencesViewMode: ViewMode                    // silences view (key 'jarvis-silencesViewMode')
  isFullscreen: boolean                         // NOT persisted
  selectedFingerprint: string | null            // NOT persisted (detail panel target)
  filters: {
    state: string                              // default 'active'
    search: string
    labelMatchers: LabelMatcher[]              // includes locked default-filter chips
  }
  wsConnected: boolean                         // NOT persisted
  pollingPaused: boolean                       // NOT persisted (resets to false)
  alertCounts: AlertCounts                      // { filtered, total, byState: { active, suppressed, resolved }, silenceCount }
}
// syncLockedMatchers(defaults) replaces locked matchers from Settings, preserves user-added ones.
// URL params override persisted state on first mount; afterwards store → URL (replaceState).
```

## Settings Store (`useSettingsStore`, persisted under `jarvis-user-settings`)

```typescript
interface UserSettings {
  theme: 'dark' | 'light'                       // default 'dark'
  timeFormat: 'relative' | 'absolute'           // default 'relative'
  defaultViewMode: 'card' | 'list'              // default 'card'
  groupByLabel: string                          // card/list grouping label; default 'severity'
  defaultFilters: DefaultFilter[]               // locked header chips; default []
  resolvedPageSize: 10 | 25 | 50 | 100          // default 25
  defaultSilenceDurationMinutes: number         // default 60; ALLOWED_SILENCE_DURATIONS = [15,30,60,240,480,1440,4320]
  defaultCreatorName: string                    // default ''
  pollIntervalSeconds: number                   // default 15; POLL_OPTIONS = [5,10,15,20,25,30,60]
  claimAnimationEnabled: boolean                // default true
}
```

## localStorage Keys (complete)

`jarvis-ui` · `jarvis-viewMode` · `jarvis-activeViewMode` · `jarvis-silencesViewMode` ·
`jarvis-user-settings` · `jarvis-username` (manual author in mode "none") ·
`jarvis_noauth_notice_dismissed` ·
`jarvis-card-section-order:<label>` · `jarvis-list-section-order:<label>`
(drag-and-drop section order per grouping label)

## URL State Params

| Param | Example | Default (not in URL) |
|---|---|---|
| `state` | `active` | `active` (always written) |
| `q` | `node` | empty |
| `matchers` | `[{"name":"env","operator":"=","value":"prod"}]` | empty — **only unlocked** matchers are serialized (locked ones come from Settings on mount) |
| `alert` | `<cluster>::<fingerprint>` (URL-encoded selection key from `lib/alertSelection.ts`; legacy fingerprint-only still parsed) | empty |

**Hydration order**: URL params → store (on first mount). Afterwards: store → URL (`replaceState`).

---

## WebSocket Events

| Type | Payload | Frontend action |
|---|---|---|
| `alerts_update` | `{ alerts: EnrichedAlert[] }` | `queryClient.setQueryData(['alerts'], alerts)` |
| `claim_set` | `{ fingerprint, clusterName, claim }` | patch alerts cache + invalidate claim queries (cluster-scoped keys) |
| `claim_released` | `{ fingerprint, clusterName, releasedBy }` | set `activeClaim` to `undefined` + invalidate claim queries |
| `comment_added` | `{ fingerprint, comment }` | invalidate comments query (cluster-scoped key) |

---

## Authentication & Authorization

**Providers** (`JARVIS_AUTH_PROVIDER`): `none` · `internal` (bcrypt accounts, first-run `/setup`) · `oidc` (PKCE flow).
**Protection** (`JARVIS_AUTH_MODE`, ignored when provider=none): `write_protect` (reads public, writes need login) · `full_protect` (everything needs login).

- **Middleware**: `RequireAuth` (valid JWT cookie/header) on write routes + `/auth/me`; `RequireAdmin` on `/api/v1/admin/*`; `firstRunRedirect` → `/setup` when internal mode has no users.
- **JWT**: HMAC-SHA256 signed with `JARVIS_SECRET_KEY`; claims `sub, username, email, role, provider, exp, iat`; delivered as secure HttpOnly cookie.
- **OIDC**: `/auth/oidc/start` (PKCE + state cookie) → issuer → `/auth/oidc/callback` (state CSRF check, ID-token verify, `UpsertOIDCUser` by `sub`). Admin role from `JARVIS_OIDC_ADMIN_CLAIM` == `JARVIS_OIDC_ADMIN_VALUE`.
- **Rate limits**: `/setup` 6/min · `/auth/login` 12/min · writes 30/min · `/poll` 1/5s · `/admin/users` 30/min.
- **Admin guards**: cannot change own role; cannot delete self.

## Config / Env Vars (`internal/config`)

| Var | Notes |
|---|---|
| `JARVIS_PORT` `JARVIS_LOG_LEVEL` `JARVIS_LOG_REQUESTS` `JARVIS_POLL_INTERVAL` | server basics — defaults: `8080`, `info`, `false`, `15s` |
| `JARVIS_DB_DSN` | `postgres://` or `postgresql://` → PostgreSQL, anything else → SQLite file path. Default `/data/jarvis.db`. Never logged raw (`db.RedactDSN()`) |
| `JARVIS_RUNBOOK_BASE_URL` | prefix for non-URL `runbook` values |
| `JARVIS_ALLOWED_ORIGINS` | CORS + WS origin allow-list (no `*`), comma-separated |
| `JARVIS_AUTH_PROVIDER` `JARVIS_AUTH_MODE` | auth; provider default `none`; mode defaults to `write_protect` when provider ≠ none |
| `JARVIS_SECRET_KEY` | JWT HMAC key, hex-decoded if valid hex, else raw bytes; **≥32 bytes required** when provider ≠ none |
| `JARVIS_AUTH_OIDC_ISSUER` `…_CLIENT_ID` `…_CLIENT_SECRET` `…_REDIRECT_URL` `…_SCOPES` | OIDC (scopes default `openid,profile,email`) |
| `JARVIS_OIDC_ADMIN_CLAIM` `JARVIS_OIDC_ADMIN_VALUE` | OIDC → admin role mapping |
| `JARVIS_CLUSTER_N_NAME` `…_ALERTMANAGER_URL` `…_PROMETHEUS_URL` `…_HOST_ALIAS` | per-cluster; N iterated from 1 until NAME empty; `ALERTMANAGER_URL` accepts a comma-separated HA member list; `HOST_ALIAS` rewrites the browser-visible AM link URL — one value for all members, or a comma list index-matched to `ALERTMANAGER_URL` |
| `JARVIS_CLUSTER_N_BASIC_AUTH_USER` `…_BASIC_AUTH_PASSWORD` `…_BEARER_TOKEN` | per-cluster upstream auth |
| `JARVIS_CLUSTER_N_HEADER_<Name>` | arbitrary custom HTTP header sent with every upstream request (header name taken verbatim after `HEADER_`) |
| `JARVIS_CLUSTER_N_OAUTH2_CLIENT_ID` `…_OAUTH2_CLIENT_SECRET` `…_OAUTH2_TOKEN_URL` `…_OAUTH2_SCOPES` | per-cluster OAuth2 client-credentials (takes priority over bearer/basic/headers) |

---

## Alertmanager HA Clusters (member deduplication)

`JARVIS_CLUSTER_N_ALERTMANAGER_URL` accepts a **comma-separated list** of
member URLs — one Jarvis cluster maps to N Alertmanager HA members (a gossip
cluster). A single URL is exactly today's one-member behavior; existing
single-URL configs and their API/WS payloads are unchanged (`members` /
`seenOn` fields stay `omitempty`).

**Config layer** (`internal/config/config.go`): `ClusterConfig.Members
[]MemberConfig` holds one `{Name, URL, LinkURL}` per member (`Name` = the
URL's `host:port`, via `DeriveMemberName`). `AlertmanagerURL` /
`AlertmanagerLinkURL` on `ClusterConfig` always mirror `Members[0]` for
single-member call sites. Duplicate member URLs within one cluster → startup
error. Auth (`BASIC_AUTH`, `BEARER_TOKEN`, `HEADER_*`, `OAUTH2_*`) lives on
`ClusterConfig` (not per-member) and applies to all members alike — HA
members share auth setup in practice. `HOST_ALIAS` (`splitHostAliases` in
`config.go`) is either one value (applies to all members) or a
comma-separated list index-matched to `ALERTMANAGER_URL`, one alias per
member — a count that is neither 1 nor exactly the member count is a
startup error.

**Cluster layer** (`internal/cluster/`): `Cluster.Members []*Member` (each
with its own `*alertmanager.Client`); `Cluster.AlertmanagerURL` /
`AlertmanagerLinkURL` / `Client` mirror `Members[0]` for back-compat.

- `Cluster.FetchAlerts(ctx, onDuration)` polls all members in parallel,
  merges by fingerprint via `mergeAlerts` (`merge.go`) — union semantics
  (alert kept if ANY member reports it), freshest `UpdatedAt` wins on
  conflict, `SeenOn` lists members in config order. Returns an error only
  when **all** members fail (single-member failure ≠ cluster failure).
  `SeenOn` is cleared when the cluster has exactly one configured member, so
  single-member JSON payloads stay byte-identical.
- `Cluster.FetchSilences(ctx, onDuration)` mirrors this for silences, merging
  by ID via `mergeSilences` (freshest `UpdatedAt` wins); no `SeenOn` tracking
  for silences.
- `Cluster.PingAll(ctx)` live-pings every member in parallel (used by
  `GET /api/v1/clusters`); cluster `Healthy` = any member healthy (UI shows
  e.g. "2/2 members up", amber when degraded).
- `Cluster.CreateSilence` / `DeleteSilence` send to the first healthy member
  (config order, from the cached up-state set by the last `FetchAlerts`),
  retrying once against the next member on transport failure — never to all
  members, since gossip already replicates and posting to every member would
  create duplicates.
- Enrichment (`cluster/enrich.go`, `enrichMerged`) — moved here from
  `history` — builds `EnrichedAlert` (incl. `@receiver` label) from merged
  alerts; lives in `cluster` because `history` imports `cluster` (not the
  reverse).
- History recorder keying is untouched: events stay keyed by
  `(fingerprint, cluster_name)`, since the merge happens *before* the
  recorder sees the snapshot — grace period and occurrence counting
  (Critical Invariants #1, #2) are unaffected by member count.

---

## Alert Lifecycle State Machine

```
firing → suppressed   (silence activated)
       → resolved     (alert gone from AM API)

suppressed → firing   (silence expired/deleted → expired event + new firing event)
           → resolved (problem fixed while silence was active → no expired event)

resolved → firing     (alert reappears)
```

**Edge case `suppressed → resolved`**: If the alert disappears while silence is still active → directly `resolved`, no `expired` event. Claims are auto-released with `reason: resolved`.

Grace period and `occurrence_count` rules are Critical Invariants #1 and #2 in
the root `AGENTS.md`.

## Silence UI States

Silence states as rendered in the UI: `pending` / `suppressed` / `expiring`
(≤15 min) / `expired` (≤2h) / `expired` (>2h) — all derived in
`getEffectiveAlertState` (`lib/alertUtils.ts`).
