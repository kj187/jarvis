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
    Fingerprint     string    `json:"fingerprint"`
    Alertname       string    `json:"alertname"`
    ClusterName     string    `json:"clusterName"`
    FirstSeenAt     time.Time `json:"firstSeenAt"`
    LastSeenAt      time.Time `json:"lastSeenAt"`
    OccurrenceCount int       `json:"occurrenceCount"`
}

// ── Comment ───────────────────────────────────────────────────────────────────
type Comment struct {
    ID          int64     `json:"id"`
    Fingerprint string    `json:"fingerprint"`
    EventID     *int64    `json:"eventId,omitempty"`
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

## SQLite Schema (`internal/db/db.go`)

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
    created_at   DATETIME NOT NULL DEFAULT (datetime('now'))
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_alert_events_fingerprint    ON alert_events(fingerprint);
CREATE INDEX IF NOT EXISTS idx_alert_events_starts_at      ON alert_events(starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_comments_fingerprint  ON alert_comments(fingerprint);
CREATE INDEX IF NOT EXISTS idx_alert_claims_fingerprint    ON alert_claims(fingerprint);
CREATE INDEX IF NOT EXISTS idx_alert_claims_active         ON alert_claims(fingerprint) WHERE released_at IS NULL;
```

**SQLite settings** (on open): `SetMaxOpenConns(1)`, `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`, `PRAGMA busy_timeout=5000`.

---

## API Endpoints (`/api/v1/`)

```
# Alerts (in-memory AlertStore)
GET  /api/v1/alerts                              → []EnrichedAlert
     ?cluster=homelab  ?severity=critical  ?state=firing|resolved
GET  /api/v1/alerts/groups                       → []AlertGroup   ← register BEFORE :fingerprint/*!

# Alert details (SQLite)
GET  /api/v1/alerts/:fingerprint/history         → { events: AlertEvent[], total: int }
     ?limit=20 &offset=0
GET  /api/v1/alerts/:fingerprint/stats           → AlertStats

# Comments
GET  /api/v1/alerts/:fingerprint/comments        → []Comment (newest first)
POST /api/v1/alerts/:fingerprint/comments        Body: { authorName, body, eventId? }
DEL  /api/v1/alerts/:fingerprint/comments/:id   → 204

# Claims
GET  /api/v1/alerts/:fingerprint/claim           → Claim | 404
POST /api/v1/alerts/:fingerprint/claim           → Claim (201)  Body: { claimedBy, note?, eventId? }
DEL  /api/v1/alerts/:fingerprint/claim           → 204  ?by=username
GET  /api/v1/alerts/:fingerprint/claims/history  → []Claim

# Silences (proxy → Alertmanager)
GET  /api/v1/silences                            → []Silence  ?cluster=homelab
POST /api/v1/silences                            → { id: string } (201)
     Body: { cluster, matchers[], startsAt, endsAt, createdBy, comment, id?, fingerprint?, performedBy? }
     If id is set → update/extend. If fingerprint is set → record in alert_events.
DEL  /api/v1/silences/:id                        → 204  ?cluster=homelab &fingerprint=... &by=username

# Cluster
GET  /api/v1/clusters                            → []ClusterInfo
GET  /api/v1/status                              → { status, clusters, alerts, ws_clients }
GET  /health                                     → { status: "ok" }

# WebSocket
WS   /ws

# Static (production build tag only)
GET  /*                                          → embed.FS (Vite build)
```

---

## Frontend Component Tree (`frontend/src/`)

```
main.tsx              → ReactDOM.createRoot, QueryClient, App
App.tsx               → Router + RootLayout
├── api/client.ts     → All fetch wrappers against /api/v1/*
├── store/uiStore.ts  → Zustand: viewMode, filters, selectedFp, wsConnected, pollingPaused
├── types/index.ts    → Alert, Silence, Claim, Comment, AlertEvent, AlertStats, LabelMatcher, ...
├── hooks/
│   ├── useAlerts.ts           → useAlerts, useAlertGroups, useAlertHistory, useAlertStats
│   ├── useAlertComments.ts    → useAlertComments, useAddComment, useDeleteComment
│   ├── useAlertClaim.ts       → useClaim, useClaimHistory, useSetClaim, useReleaseClaim
│   ├── useSilences.ts         → useSilences, useUpsertSilence, useDeleteSilence
│   └── useWebSocket.ts        → WS connection + cache patching via handleEvent()
├── lib/
│   └── alertUtils.ts          → getFilterableLabels, matchesLabelMatchers, safeRegex,
│                                 getEffectiveAlertState  ← single source, never duplicate
└── components/
    ├── ui/                    → shadcn/ui components
    ├── layout/Header.tsx      → Nav, cluster status, WS indicator, polling controls, filters
    ├── alerts/
    │   ├── AlertsPage.tsx     → load useWebSocket, filter, render card/list + panel
    │   ├── AlertCardGrid.tsx  → severity-grouped cards
    │   ├── AlertCard.tsx      → card + claim avatar badge + count badge
    │   ├── AlertListView.tsx  → table view
    │   ├── AlertListRow.tsx   → single table row
    │   ├── AlertDetailPanel.tsx → slide-over (all sections incl. inline history)
    │   ├── AlertComments.tsx  → comment list + input form
    │   ├── AlertClaimSection.tsx → claim UI + history + buttons
    │   ├── AlertBadge.tsx     → severity badge
    │   ├── AlertFilters.tsx   → label matcher chips + state dropdown
    │   ├── LabelChip.tsx      → label chip with color style (shared by labels + filter chips)
    │   └── ViewToggle.tsx     → ⊞ / ☰ toggle
    └── silences/
        ├── SilencesPage.tsx   → silence list
        ├── SilenceCard.tsx    → status, matchers, expiry
        ├── SilenceExpiry.tsx  → "expired X ago" / "expires in X"
        └── SilenceForm.tsx    → matcher builder (create/edit)
```

---

## `uiStore` Interface

```typescript
interface UIStore {
  viewMode: 'card' | 'list'                    // persist in localStorage
  selectedFingerprint: string | null           // NOT persisted
  filters: {
    state: string
    search: string
    labelMatchers: LabelMatcher[]
  }                                            // persist in localStorage
  wsConnected: boolean                         // NOT persisted
  pollingPaused: boolean                       // NOT persisted
}
// URL params override localStorage on first mount (hasHydratedFromUrlRef)
```

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
