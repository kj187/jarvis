---
description: Full architecture reference — data model, API endpoints, component tree, state machine, data flow
---

# Jarvis — Full Architecture Reference

Slash-Command: `/project:architecture`

For deep feature work, refactoring, new API endpoints, and any situation that requires full context about the data model, API, or state transitions.

---

## Go-Models (`internal/models/models.go`)

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
    LastResolvedAt  *time.Time `json:"lastResolvedAt,omitempty"`
    OccurrenceCount int        `json:"occurrenceCount"`
}

// ── Comment ───────────────────────────────────────────────────────────────────
type Comment struct {
    ID          int64     `json:"id"`
    Fingerprint string    `json:"fingerprint"`
    EventID     *int64    `json:"eventId,omitempty"`
    UserID      *string   `json:"userId,omitempty"`   // set when auth enabled; nil for mode "none"
    AuthorName  string    `json:"authorName"`
    Body        string    `json:"body"`
    CreatedAt   time.Time `json:"createdAt"`
}

// ── Claim ─────────────────────────────────────────────────────────────────────
type Claim struct {
    ID            int64      `json:"id"`
    Fingerprint   string     `json:"fingerprint"`
    EventID       *int64     `json:"eventId,omitempty"`
    ClaimedBy     string     `json:"claimedBy"`
    ClaimedAt     time.Time  `json:"claimedAt"`
    Note          string     `json:"note,omitempty"`
    ReleasedAt    *time.Time `json:"releasedAt,omitempty"`
    ReleasedBy    string     `json:"releasedBy,omitempty"`
    ReleaseReason string     `json:"releaseReason,omitempty"` // manual | resolved | reclaimed
}

// ── WebSocket Events ──────────────────────────────────────────────────────────
type WSEvent struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"`
}
const (
    WSTypeAlertsUpdate  = "alerts_update"   // payload: { alerts: EnrichedAlert[] }
    WSTypeClaimSet      = "claim_set"        // payload: { fingerprint, claim }
    WSTypeClaimReleased = "claim_released"   // payload: { fingerprint, releasedBy }
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

// ── User (internal + OIDC accounts) ──────────────────────────────────────────
// Role: user | admin · Provider: internal | oidc
type User struct {
    ID           string     `json:"id"`
    Username     string     `json:"username"`
    Email        string     `json:"email,omitempty"`
    Role         string     `json:"role"`
    Provider     string     `json:"provider"`
    CreatedAt    time.Time  `json:"createdAt"`
    LastLoginAt  *time.Time `json:"lastLoginAt,omitempty"`
}

// ── Cluster ───────────────────────────────────────────────────────────────────
type ClusterInfo struct {
    Name            string `json:"name"`
    AlertmanagerURL string `json:"alertmanagerUrl"`
    PrometheusURL   string `json:"prometheusUrl"`
    Healthy         bool   `json:"healthy"`
    AlertCount      int    `json:"alertCount"`
}

// ── AlertGroup ────────────────────────────────────────────────────────────────
type AlertGroup struct {
    Alertname string          `json:"alertname"`
    Severity  string          `json:"severity"`
    Alerts    []EnrichedAlert `json:"alerts"`
    Count     int             `json:"count"`
}
```

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
    user_id      TEXT REFERENCES users(id)   -- added via ALTER; NULL in mode "none"
);

CREATE TABLE IF NOT EXISTS alert_claims (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint    TEXT NOT NULL REFERENCES alert_fingerprints(fingerprint),
    event_id       INTEGER REFERENCES alert_events(id),
    claimed_by     TEXT NOT NULL,
    claimed_at     DATETIME NOT NULL DEFAULT (datetime('now')),
    note           TEXT,
    released_at    DATETIME,
    released_by    TEXT,
    release_reason TEXT  -- manual | resolved | reclaimed
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
CREATE INDEX IF NOT EXISTS idx_alert_claims_active               ON alert_claims(fingerprint) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_silence_events_fingerprint        ON silence_events(fingerprint, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_username                    ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_oidc_sub                    ON users(oidc_sub);
```

**SQLite settings** (on open): `SetMaxOpenConns(1)`, `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`, `PRAGMA busy_timeout=5000`. PostgreSQL uses the default pool (no `SetMaxOpenConns(1)`).

---

## API Endpoints

Auth column: **None** = public · **Auth** = `RequireAuth` (valid JWT) · **Admin** = `RequireAdmin` (role=admin).
When `JARVIS_AUTH_MODE=full_protect`, **all** `/api/v1/*` routes additionally require auth (the `full_protect?`
marker below). Write routes are rate-limited (`writeRL` = 30/min); `/poll` is limited to 1 req/5s.

```
# ── Health / Auth / Setup ────────────────────────────────────────────────────
GET    /health                                   None        → { status: "ok" }
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

# ── Alert details (history store / SQLite) ───────────────────────────────────
GET    /api/v1/alerts/:fingerprint/history       full_protect?  → { events: AlertEvent[], total }  ?limit= ?offset=
GET    /api/v1/alerts/:fingerprint/stats         full_protect?  → AlertStats
GET    /api/v1/alerts/:fingerprint/silence-events full_protect? → []SilenceEvent   (silence action timeline)

# ── Comments ─────────────────────────────────────────────────────────────────
GET    /api/v1/alerts/:fingerprint/comments      full_protect?  → []Comment
POST   /api/v1/alerts/:fingerprint/comments      Auth  (write)  Body: { authorName, body, eventId? }
DELETE /api/v1/alerts/:fingerprint/comments/:id  Auth  (write)  (author-gated: user_id, else author_name)

# ── Claims ───────────────────────────────────────────────────────────────────
GET    /api/v1/alerts/:fingerprint/claim         full_protect?  → Claim | 404
POST   /api/v1/alerts/:fingerprint/claim         Auth  (write)  Body: { claimedBy, note?, eventId? }
DELETE /api/v1/alerts/:fingerprint/claim         Auth  (write)  ?by=username
GET    /api/v1/alerts/:fingerprint/claims/history full_protect? → []Claim

# ── Silences (proxy → Alertmanager) ──────────────────────────────────────────
GET    /api/v1/silences                          full_protect?  → []Silence  ?cluster=
POST   /api/v1/silences                          Auth  (write)  → { id } (id set → update; fingerprint set → record event)
DELETE /api/v1/silences/:id                      Auth  (write)  ?cluster= &fingerprint= &by=

# ── Silence Templates (DB, shared) ───────────────────────────────────────────
GET    /api/v1/silence-templates                 full_protect?  → []SilenceTemplate
POST   /api/v1/silence-templates                 Auth  (write)  Body: { name, matchers[], reason? }
PUT    /api/v1/silence-templates/:id             Auth  (write)  Body: { name, matchers[], reason? }
DELETE /api/v1/silence-templates/:id             Auth  (write)

# ── Poll / Clusters ──────────────────────────────────────────────────────────
POST   /api/v1/poll                              None  (RL)   → triggers an immediate Alertmanager poll
GET    /api/v1/clusters                          full_protect?  → []ClusterInfo

# ── Admin (auth + role=admin) ────────────────────────────────────────────────
GET    /api/v1/admin/users                       Admin        → []User
POST   /api/v1/admin/users                       Admin (RL)   Body: { username, password, role }
PATCH  /api/v1/admin/users/:id                   Admin        Body: { role }  (cannot change own role)
DELETE /api/v1/admin/users/:id                   Admin        (cannot delete self)

# ── Static (production build tag only) ───────────────────────────────────────
GET    /*                                         None        → embed.FS (Vite build); SPA fallback to index.html
                                                              firstRunRedirect → /setup when internal mode + no users
```

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
│   ├── useAlerts.ts           → useAlerts, useAlertGroups, useAlertHistory, useAlertStats
│   ├── useAlertCounts.ts      → per-state alert counts for nav badges
│   ├── useAlertComments.ts    → useAlertComments, useAddComment, useDeleteComment
│   ├── useAlertClaim.ts       → useClaim, useClaimHistory, useSetClaim, useReleaseClaim
│   ├── useSilences.ts         → useSilences, useUpsertSilence, useDeleteSilence
│   ├── useSilenceTemplates.ts → list + create/update/delete template mutations
│   ├── useWebSocket.ts        → WS connection + cache patching via handleEvent()
│   ├── useProtectedAction.ts  → wraps write actions; opens LoginModal when auth required
│   ├── useFormatTime.ts       → relative/absolute timestamp formatter (from settings)
│   └── useVersion.ts          → app version (staleTime Infinity)
├── lib/
│   ├── alertUtils.ts          → getFilterableLabels, matchesLabelMatchers, safeRegex,
│   │                            getEffectiveAlertState  ← single source, never duplicate
│   ├── linkUtils.tsx          → extractLinkButtons (URL-valued labels/annotations + runbook logic)
│   └── utils.ts               → cn() + misc helpers
└── components/
    ├── ui/                    → shadcn/ui: button, card, badge, dialog, sheet, select, input,
    │                            textarea, date-time-picker
    ├── layout/
    │   ├── Header.tsx         → nav tabs, cluster status, WS indicator, polling/refresh, theme,
    │   │                        settings, create-silence, login/user-menu, mobile hamburger
    │   └── MatcherChipsBar.tsx → chip-based label filter (=, !=, =~, !~), tag multi-value,
    │                            suggestions, locked default-filter chips
    ├── alerts/
    │   ├── AlertsPage.tsx     → useWebSocket, filter/search, card|list + detail panel, fullscreen, pagination
    │   ├── AlertCardGrid.tsx  → severity-grouped, responsive column binning, per-group pagination
    │   ├── AlertCard.tsx      → card + claim banner + count badge + silence/detail actions
    │   ├── AlertListView.tsx  → sortable table (name/time), expandable groups
    │   ├── AlertListRow.tsx   → single/indented row
    │   ├── AlertDetailPanel.tsx → slide-over: labels/annotations + link buttons, stats & timeline,
    │   │                          claim, comments, silence controls, AI-prompt section
    │   ├── AlertComments.tsx  → comment list + input (author-gated delete)
    │   ├── AlertClaimSection.tsx → claim UI + history + buttons
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
    │   │                        overlap/zero-match warnings) → preview → per-cluster results
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
  alertCounts: AlertCounts                      // per-state counts for nav badges
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
  defaultFilters: DefaultFilter[]               // locked header chips; default []
  resolvedPageSize: 10 | 25 | 50 | 100          // default 25
  defaultSilenceDurationMinutes: number         // default 60
  defaultCreatorName: string                    // default ''
  pollIntervalSeconds: number                   // default 15
  claimAnimationEnabled: boolean                // default true
}
```

## localStorage Keys (complete)

`jarvis-ui` · `jarvis-viewMode` · `jarvis-activeViewMode` · `jarvis-silencesViewMode` ·
`jarvis-user-settings` · `jarvis-username` (manual author in mode "none") ·
`jarvis_noauth_notice_dismissed`

## URL State Params

| Param | Example | Default (not in URL) |
|---|---|---|
| `view` | `list` | `card` |
| `state` | `active` | empty |
| `q` | `node` | empty |
| `matchers` | `[{"name":"env","operator":"=","value":"prod"}]` | empty |
| `alert` | `<fingerprint>` | empty |

**Hydration order**: URL params → store (on first mount). Afterwards: store → URL (`replaceState`).

---

## WebSocket Events

| Type | Payload | Frontend action |
|---|---|---|
| `alerts_update` | `{ alerts: EnrichedAlert[] }` | `queryClient.setQueryData(['alerts'], alerts)` |
| `claim_set` | `{ fingerprint, claim }` | patch alerts cache + invalidate `['claim', fp]` + `['claim-history', fp]` |
| `claim_released` | `{ fingerprint, releasedBy }` | set `activeClaim` to `undefined` + invalidate claim queries |
| `comment_added` | `{ fingerprint, comment }` | invalidate `['comments', fp]` |

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
| `JARVIS_PORT` `JARVIS_LOG_LEVEL` `JARVIS_LOG_REQUESTS` `JARVIS_POLL_INTERVAL` | server basics |
| `JARVIS_DB_DSN` (`JARVIS_DB_PATH` legacy) | `postgres://…` → PostgreSQL, else SQLite path |
| `JARVIS_RUNBOOK_BASE_URL` | prefix for non-URL `runbook` values |
| `JARVIS_ALLOWED_ORIGINS` | CORS + WS origin allow-list (no `*`) |
| `JARVIS_AUTH_PROVIDER` `JARVIS_AUTH_MODE` `JARVIS_SECRET_KEY` | auth |
| `JARVIS_AUTH_OIDC_ISSUER` `…_CLIENT_ID` `…_CLIENT_SECRET` `…_REDIRECT_URL` `…_SCOPES` | OIDC |
| `JARVIS_OIDC_ADMIN_CLAIM` `JARVIS_OIDC_ADMIN_VALUE` | OIDC → admin role mapping |
| `JARVIS_CLUSTER_N_NAME` `…_ALERTMANAGER_URL` `…_PROMETHEUS_URL` `…_HOST_ALIAS` | per-cluster |
| `JARVIS_CLUSTER_N_BASIC_AUTH_USER` `…_BASIC_AUTH_PASSWORD` `…_BEARER_TOKEN` | per-cluster upstream auth |
| `JARVIS_CLUSTER_N_OAUTH2_CLIENT_ID` `…_OAUTH2_CLIENT_SECRET` `…_OAUTH2_TOKEN_URL` `…_OAUTH2_SCOPES` | per-cluster OAuth2 client-credentials |

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

**Grace Period (60s)**: Alert seen again after a `resolved` event within 60s → reopen old event instead of creating a new one (prevents ghost-resolve entries on transient poll misses).

**`occurrence_count`**: Only incremented when `hadPreviousEvent = true`. On the very first firing = 1 (never incremented).

---

## Common Pitfalls (avoid when writing new code)

| Problem | Solution |
|---|---|
| Duplicate `matchesLabelMatchers` in a component | Always import from `lib/alertUtils.ts` |
| Forgetting `console.log` in production code | Check before every commit |
| Registering `alerts/groups` route after `:fingerprint/*` | Put `groups` route first in `router.go` |
| Incrementing `occurrence_count` on first firing | Only when `hadPreviousEvent = true` |
| Setting WS `CheckOrigin` to `return true` | Validate against `cfg.AllowedOrigins` |
| Using `dangerouslySetInnerHTML` in frontend | Never use it |
| HTTP calls without context + timeout | Always set `context.WithTimeout` |
