# Jarvis Architecture — API, Auth, Config, Metrics

Part of the architecture reference — start at `.agents/architecture.md` (index). Base rules and critical invariants live in the root `AGENTS.md`; when this file contradicts the code, the code wins.

---

## API Endpoints

Auth column: **None** = public · **Auth** = `RequireAuth` (valid JWT) · **Admin** = `RequireAdmin` (role=admin).
When `JARVIS_AUTH_MODE=full_protect`, **all** `/api/v1/*` routes additionally require auth (the `full_protect?`
marker below). Rate limit: one global bucket for `POST /auth/login` only (0.5 req/s = 30/min, burst 10),
per-process (each pod's own bucket on PostgreSQL HA).

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
POST   /auth/login                               None  (RL)  Body: { username, password } → user + Set-Cookie  (global 30/min rate limit)
POST   /auth/logout                              None        → clears session cookie
GET    /auth/me                                  Auth        → User { id, username, role, provider }; SSO adds email? (from the DB), and with JARVIS_OIDC_GROUPS_CLAIM set groupsClaim, groups[] (as of the last login), lastLoginAt
GET    /auth/oidc/start                          None        → 302 redirect to OIDC issuer (PKCE). Optional ?popup=1 (login in a
#                                                              popup: callback lands on /?login=popup-done, the SPA notifies the opener
#                                                              over BroadcastChannel 'jarvis-auth' and closes) or ?return_to=<in-app path>
#                                                              (validated by sanitizeReturnTo: relative, no //, no \, no /auth /api /ws).
#                                                              Both ride in the state cookie (`state|verifier[|popup|r:<b64url>]`,
#                                                              oidc_flow.go) — the callback re-validates, a forged cookie falls back to /
GET    /auth/oidc/callback                       None        → exchanges code, sets cookie, 302 → landing target (/ | popup-done | return_to)
POST   /setup                                    None        Body: { username, password } (internal mode only; 403 if users exist)

# ── WebSocket ────────────────────────────────────────────────────────────────
WS     /ws                                       full_protect?  (origin checked against JARVIS_ALLOWED_ORIGINS;
#        in full_protect mode the upgrade request additionally requires a valid
#        session cookie via RequireAuth — /ws streams the full alert snapshot)

# ── Status / Version ─────────────────────────────────────────────────────────
GET    /api/v1/status                            full_protect?  → { status, clusters, alerts, ws_clients, leader, poll_interval_seconds }
#        leader: this pod's current leader-election state (internal/leader) — always true on SQLite
GET    /api/v1/info                              full_protect?  → { version }

# ── Alerts (in-memory AlertStore) ────────────────────────────────────────────
GET    /api/v1/alerts/groups                     full_protect?  → []AlertGroup   ← register BEFORE :fingerprint/*!
GET    /api/v1/alerts                            full_protect?  → []EnrichedAlert  ?cluster= ?severity= ?state=
#        AlertStore.Get() returns a deterministic total order — startsAt desc, then
#        fingerprint asc, then clusterName asc — so every poll delivers the same
#        ordering (upstream AM response order and resolved-buffer map iteration are
#        not stable); prevents frontend alert-group flicker. Groups inherit it, then
#        re-sort the group list itself by severity, then alertname.
#        resolvedBuffer is map[fingerprint+cluster]resolvedEntry. Each entry expires
#        exactly 20 minutes after its episode's EndsAt. Recorder owns one 1s sweeper;
#        active alerts win duplicate keys and repeated snapshot rebuilds do not extend TTL.
#        AlertStore also holds a version counter (bumped by every mutation that changes
#        what Get() would return — a no-op mutation, e.g. SetActiveClaim on a missing
#        alert, never bumps it) and a cached JSON array encoding invalidated by a version
#        mismatch: EncodedSnapshot() returns that cache (rebuilding at most once per
#        change), reused for both the unfiltered GET /api/v1/alerts response
#        (c.JSONBlob, no re-marshal) and the alerts_update WS envelope (byte
#        concatenation around the cached array, no second json.Marshal of the alert
#        list). Set/SetActiveClaim clone incoming Labels/Annotations/Receivers/Status
#        slices/Claim (incl. its pointer fields) so a caller mutating its own copy
#        afterward can never alias store-internal data — Get()'s returned alerts still
#        share that data with the store and must be treated read-only by callers.
#        state=resolved is the legacy persistent-history read: Store.VisitResolved scans
#        latest resolved episodes row-by-row (recorded_at DESC, id DESC), and the handler
#        streams one JSON array element at a time through a 32 KiB buffer under a 10s
#        request/DB timeout. It never materializes the full DB result; cluster is pushed
#        into SQL, severity is filtered during iteration. A failure after HTTP commit
#        aborts the connection, so clients never receive a closed, apparently valid
#        partial array. GetAllResolved remains only as a test/benchmark adapter.
GET    /api/v1/alerts/resolved                   full_protect?  → { alerts: EnrichedAlert[], total, invalidMatchers: number[] }
#        Additive bounded-history API: limit=10|25|50|100 (default 25), offset>=0,
#        optional cluster/severity/search/matchers/fingerprint. Static route is
#        registered before /alerts/:fingerprint/*. Fast requests page + count in
#        one read-only transaction; filtered requests scan once in server order,
#        retain at most one page, and decode annotations only for retained rows.
#        PostgreSQL uses Repeatable Read so rows and total share a snapshot.
#        internal/alertfilter owns Resolved-only RE2 matcher semantics and search
#        over individual real label names/values; invalid regex indices are returned
#        instead of making the request invalid. Request validation and DB work share
#        a 10s context. Fingerprint detail mode returns total 0 or 1.

# ── Alert details (history store / DB) ───────────────────────────────────────
GET    /api/v1/alerts/:fingerprint/history       full_protect?  → { events: AlertEvent[], total }  ?limit= ?offset= ?cluster=
GET    /api/v1/alerts/:fingerprint/timeline      full_protect?  → []AlertTimelineEntry  (merged alert+claim+silence history)
GET    /api/v1/alerts/:fingerprint/stats         full_protect?  → AlertStats  ?cluster=
GET    /api/v1/alerts/:fingerprint/heatmap       full_protect?  → AlertHeatmapResponse  ?cluster= &range=24h|7d|30d (required)
#        firing-event timestamps (recorded_at of status='firing' alert_events rows, one per
#        distinct starts_at episode — a silence expiring mid-episode replays as a fresh firing row
#        with the *same* starts_at, so GetFiringStarts dedupes by starts_at; the 60s grace period
#        only covers resolve+refire, not this suppressed/expired/firing sequence), capped at 10000,
#        newest first. Uses recorded_at (when Jarvis observed the event), not starts_at (AM's
#        upstream condition-start time), so heatmap buckets agree with "Last fired" / history log
#        for the same event
#        internally; range maps to a lookback window (24h/7d/30d). Bucketing into hourly/daily
#        cells happens entirely in the frontend (lib/heatmapUtils.ts bucketFiringStarts) so
#        day/hour boundaries use the browser's local timezone, not the server's.
GET    /api/v1/alerts/:fingerprint/silence-events full_protect? → []SilenceEvent   (silence action timeline)

# ── Comments ─────────────────────────────────────────────────────────────────
GET    /api/v1/alerts/:fingerprint/comments      full_protect?  → { comments: Comment[], total }  ?limit= ?offset= ?cluster= (required)
#        mirrors the history/timeline pagination pattern: default limit 20, max 100, offset >= 0
#        (parseFingerprintClusterPagination); ORDER BY created_at DESC, id DESC (newest first)
POST   /api/v1/alerts/:fingerprint/comments      Auth  (write)  Body: { authorName, body, eventId? }  (body capped at 10000 chars → 400)
DELETE /api/v1/alerts/:fingerprint/comments/:id  Auth  (write)  (author-gated: user_id, else author_name)

# ── Claims ───────────────────────────────────────────────────────────────────
GET    /api/v1/alerts/:fingerprint/claim         full_protect?  → Claim | null  ?cluster=
POST   /api/v1/alerts/:fingerprint/claim         Auth  (write)  Body: { claimedBy, note?, eventId? }
PATCH  /api/v1/alerts/:fingerprint/claim/note    Auth  (write)  Body: { note }  (edit note of active claim)
DELETE /api/v1/alerts/:fingerprint/claim         Auth  (write)  ?by=username
GET    /api/v1/alerts/:fingerprint/claims/history full_protect? → []Claim  ?cluster=

# ── Silences (reads from in-memory SilenceStore; writes → Alertmanager) ──────
GET    /api/v1/silences                          full_protect?  → []Silence  ?cluster=
#        served entirely from history.SilenceStore (filled by the recorder poll) — NEVER calls
#        Alertmanager. A cluster whose poll-time silence fetch fails keeps its previous snapshot.
#        Silences created/expired directly in AM appear within one JARVIS_POLL_INTERVAL.
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
#        on success: write-through into SilenceStore (Upsert new + MarkExpired old id on id change)
#        + poll trigger, so the frontend's immediate refetch sees the change (applySilenceWriteThrough)
DELETE /api/v1/silences/:id                      Auth  (write)  ?cluster= (required) &fingerprint= &by=  → records "deleted" event
#        AM 4xx response → relayed as 400 (sanitized); AM 5xx/transport failure → generic 502
#        on success: SilenceStore.MarkExpired + poll trigger (same write-through pattern)

# ── Silence Templates (DB, shared) ───────────────────────────────────────────
GET    /api/v1/silence-templates                 full_protect?  → []SilenceTemplate
POST   /api/v1/silence-templates                 Auth  (write)  Body: { name, matchers[], reason? }  — validateSilenceMatchers applies
PUT    /api/v1/silence-templates/:id             Auth  (write)  Body: { name, matchers[], reason? }  — validateSilenceMatchers applies
DELETE /api/v1/silence-templates/:id             Auth  (write)

# ── Poll / Clusters ──────────────────────────────────────────────────────────
POST   /api/v1/poll                              None        → triggers an immediate Alertmanager poll
GET    /api/v1/clusters                          full_protect?  → []ClusterInfo
#        health from the cached per-member up-state of the last poll (Cluster.MemberUpStates) —
#        never live-pings AM; members without poll state yet count as healthy (writeOrder optimism)

# ── Settings (opaque JSON blob, internal/settings) ───────────────────────────
GET    /api/v1/settings                          full_protect?  → { user: {...}|null, global: {} }
#        user: null when unauthenticated OR authenticated with no row yet (frontend already
#        knows which, from authStore) — the frontend resolves the storage location itself
#        (driven by "is there an authenticated user", not authMode).
#        global: instance-wide defaults built from the env by Server.globalSettings() — only keys that
#        are configured: silenceDurations (int minutes, from JARVIS_SILENCE_DURATIONS,
#        config.ParseSilenceDurations); {} when none is set.
#        Served to anonymous callers too (the frontend reads it in local mode). Reads the DB and the
#        parsed Config only — never calls Alertmanager (Invariant #13), never cached, not leader-gated.
PUT    /api/v1/settings                          Auth        Body: the settings object (sparse; whole row replaced,
#        last write wins, no merge/versioning) — 400 on non-object JSON or a body > 16 KiB.
#        The backend never inspects individual keys (see user_settings above) — validation is
#        shape/size only.
DELETE /api/v1/settings                          Auth        deletes the row — the server side of "Reset to defaults"

# ── Admin (auth + role=admin) ────────────────────────────────────────────────
GET    /api/v1/admin/users                       Admin        → []User
POST   /api/v1/admin/users                       Admin        Body: { username, password, role }
PATCH  /api/v1/admin/users/:id                   Admin        Body: { role }  (cannot change own role)
DELETE /api/v1/admin/users/:id                   Admin        (cannot delete self)

# Generic admin-settings foundation (`internal/globalsettings`, RBAC
# label-scoped-access plan Phase 0). A "section" is a named row in
# `global_settings` (data-model.md); Phase 0 registers none, so every
# section answers 404 until a later phase (e.g. "access") calls
# `Store.Register`. No section-specific validation or merge with
# `GET /api/v1/settings` above exists yet — deliberately out of scope here.
GET    /api/v1/admin/settings                    Admin        → { sections: string[] } (currently registered section names)
GET    /api/v1/admin/settings/:section           Admin        404 if unregistered; else → { section, value, updatedAt?, updatedBy? } (value: null if never written)
PUT    /api/v1/admin/settings/:section           Admin        404 if unregistered; 400 on invalid JSON or a failing section validator; else replaces the section's value (last write wins)

# ── E2E test routes (only with -tags e2e; no-op in production builds) ────────
POST   /api/v1/test/reset                        (e2e only)  truncate history tables + clear in-memory stores (alerts + silences)
POST   /api/v1/test/seed                         (e2e only)  insert resolved-alert lifecycles
POST   /api/v1/test/claim                        (e2e only)  set claim, bypasses auth
POST   /api/v1/test/comment                      (e2e only)  add comment, bypasses auth (no WS broadcast)
POST   /api/v1/test/silence                      (e2e only)  create silence in AM, bypasses auth (same SilenceStore write-through as production)
POST   /api/v1/test/template                     (e2e only)  create silence template, bypasses auth

# ── Static (production build tag only) ───────────────────────────────────────
GET    /*                                         None        → embed.FS (Vite build); SPA fallback to index.html
                                                              firstRunRedirect → /setup when internal mode + no users
```

---

## WebSocket Events

| Type | Payload | Frontend action |
|---|---|---|
| `alerts_update` | `{ alerts: EnrichedAlert[] }` | `queryClient.setQueryData(['alerts'], alerts)` |
| `claim_set` | `{ fingerprint, clusterName, claim }` | patch alerts cache + invalidate claim queries (cluster-scoped keys) |
| `claim_released` | `{ fingerprint, clusterName, releasedBy }` | set `activeClaim` to `undefined` + invalidate claim queries |
| `comment_added` | `{ fingerprint, comment }` | invalidate comments query by prefix key `['comments', fingerprint, clusterName]` — matches every paged query key (`..., page]`) for that alert, so whichever page is mounted refetches; local `page` state is untouched (see `CommentsPanel.tsx` above for the page>1 "jump to latest" affordance) |
| `silences_update` | `{}` (pure invalidation signal) | `invalidateQueries(['silences'])` → refetch from the in-memory snapshot. Broadcast by the recorder when the silence snapshot diff changed vs. the previous poll, and by every silence mutation write-through (`applySilenceWriteThrough`) |

`claim_set`/`claim_released`/`comment_added`/the write-through `silences_update`
are mutation-driven and — on PostgreSQL, multi-replica — fanned out to every
other pod via `internal/fanout` (see "Cross-pod WS mutation fanout" in `history-and-ha.md`)
so a browser tab connected to any pod sees the same live update. The
poll-driven `alerts_update` and the recorder's own `silences_update` are
**not** fanned out — every pod already derives those from its own poll or
consumed snapshot.

---

## Authentication & Authorization

**Providers** (`JARVIS_AUTH_PROVIDER`): `none` · `internal` (bcrypt accounts, first-run `/setup`) · `oidc` (PKCE flow).
**Protection** (`JARVIS_AUTH_MODE`, ignored when provider=none): `write_protect` (reads public, writes need login) · `full_protect` (everything needs login).

- **Middleware**: `RequireAuth` (valid JWT cookie/header) on write routes + `/auth/me`; `RequireAdmin` on `/api/v1/admin/*`; `firstRunRedirect` → `/setup` when internal mode has no users.
- **`OptionalAuth`**: like `RequireAuth` (resolves the cookie and sets `auth.ContextKey`) but never rejects the request — for routes that must answer both anonymous and authenticated callers differently without requiring login (`GET /api/v1/settings` is the only user so far). A route with neither `RequireAuth` nor `OptionalAuth` never gets `auth.ContextKey` set, so `auth.UserFromContext(c)` is always nil there even with a valid cookie present — this bit a first draft of the settings endpoint (PUT wrote correctly, but the unauthenticated-by-design GET always read back `user: null`, silently "losing" every write) before `OptionalAuth` was added; `internal/api/settings_handler_test.go`'s `TestGetSettings_RealHTTPRoundTrip` guards against a regression by driving a real cookie through a real `httptest.Server` + router instead of `c.Set(auth.ContextKey, ...)`, which would mask this class of bug.
- **JWT**: HMAC-SHA256 signed with `JARVIS_SECRET_KEY`; claims `sub, name (username), role, provider, exp, iat, jti` (no e-mail, no groups); delivered as secure HttpOnly cookie.
- **OIDC**: `/auth/oidc/start` (PKCE + state cookie) → issuer → `/auth/oidc/callback` (state CSRF check, ID-token verify, `UpsertOIDCUser` by `sub`). The ID-token claim named by `JARVIS_OIDC_GROUPS_CLAIM` supplies the user's groups (stored in `users.oidc_groups` at every login); the admin role is granted when it contains `JARVIS_OIDC_ADMIN_VALUE`. The frontend runs it in a popup (`lib/ssoLogin.ts` `startSsoLogin`, `?popup=1`) so page state survives; popup-blocked and the full-page `LoginPage` use `?return_to=`.
- **Login never navigates (frontend)**: anything needing a session calls `authStore.requestLogin()` → the single `LoginPrompt`. `api/client.ts` `request()` also replays a write once after a 401 → login (session expired mid-task); a 401 on a GET only calls `expireSession()` (no dialog from background polls). The backend forces the actor (createdBy/claimedBy/authorName/by) to the session user in every auth mode ≠ none, so an action queued before login and run after it is safe with a stale client-side user.
- **Rate limit**: one global bucket for `POST /auth/login` (0.5 req/s = 30/min, burst 10, per-process).
- **Admin guards**: cannot change own role; cannot delete self.

---

## Config / Env Vars (`internal/config`)

The variables, defaults and meanings live only in `docs/configuration.md` (one
row and anchor per variable) — parsing and validation in `internal/config`,
start-up wiring in `cmd/jarvis/main.go`. Not repeated here. Two couplings the
table does not show:

- `JARVIS_POLL_INTERVAL` also drives the grace period: `main.go` sets the
  `Store` grace period to `max(60s, 2×interval)` and `Recorder.claimReleaseDelay`
  above it (Critical Invariant #1).
- `JARVIS_PPROF_ADDR` starts `internal/debugserver` (own mux and server, never
  Echo); it validates eagerly and is fatal on a bad value, like every start-up
  check (`docs/troubleshooting.md`).

---

## Metrics (`internal/metrics`)

The metric names, labels and meanings live in `docs/metrics.md` (all of them,
including `jarvis_leader` and `jarvis_snapshot_stale`); the collectors are in
`internal/metrics`. What the reference does not tell you:

- Metrics use an injected `*prometheus.Registry` (`metrics.New(version)`),
  never the global one — parallel Go tests would panic on duplicate
  registration. `history.NewRecorder` and `ws.NewHub` take a trailing
  nil-safe `*metrics.Metrics`.
- `storeCollector.Collect()` computes gauges at scrape time from
  `AlertStore`, `Hub` and the recorder's cached up-state — it never makes an
  upstream HTTP call (Invariant #13).
- `EchoMiddleware` labels by route pattern (`c.Path()`, never the raw URL) to
  bound cardinality, and skips `/metrics`, `/health`, `/ws`.
- `jarvis_poll_duration_seconds` deliberately has no `cluster` label (it times
  the whole poll cycle); `jarvis_cluster_fetch_duration_seconds` is the
  per-member counterpart.
