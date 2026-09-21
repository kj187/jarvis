# Critical Invariants — full text

The numbered list in the root `AGENTS.md` is the contract: one short rule, its code anchor and the paths it governs. This file holds the **full text and rationale** — read the entry before changing a path it governs, and when reviewing a diff read the whole file. If the two ever differ, `AGENTS.md` is the rule and this file is the fix-up; nothing enforces parity, the reviewer does.

Numbers are permanent identifiers cited from code, tests, lessons and docs: never renumber or reuse one; retire an entry in place (`Retired: <reason>`). Lifecycle: `docs/ai-agents.md`.

---

### 1.

**Grace Period (`max(60s, 2×JARVIS_POLL_INTERVAL)`)**: Alert seen again
within the grace period after `resolved` → reopen old event, create **no**
new one — prevents ghost-resolve entries on poll misses. Set via
`Store.SetGracePeriod` (`cmd/jarvis/main.go`, derived from
`cfg.PollInterval`, so a missed poll is absorbed even at intervals ≥ 60s).
`Recorder.claimReleaseDelay` (also derived in `main.go`) must exceed it, or a
claim is released before
a re-fire can reopen the event (`.agents/lessons/history-and-ha.md`).

### 2.

**Increment `occurrence_count` only on second firing**: Not on the very
first occurrence — only when `hadPreviousEvent = true`.

### 3.

**`getEffectiveAlertState`**: Alert `suppressed` + **all** covering active
silences (`status.silencedBy` can hold several) expire within ≤15 min →
returns `active`; a single longer-running silence keeps it suppressed. This
logic **only** in `lib/alertUtils.ts` — never duplicate.

### 4.

**Filter functions stay centralized, never in components**: live-browser
filtering remains exclusively in `lib/alertUtils.ts`
(`getFilterableLabels`, `matchesLabelMatchers`, `matchesAlertSearch`,
`safeRegex`). The only separate implementation is the persistent Resolved
page's server-side `internal/alertfilter` package: it deliberately uses Go
RE2 and per-label search, and shares the committed cross-language
conformance fixture checked by `scripts/check-agent-context.sh` — never
copy either implementation into handlers or components.

### 5.

**Route order in Echo router**: `/api/v1/alerts/groups` must be registered
**before** `/api/v1/alerts/:fingerprint/*`, otherwise `groups` is
interpreted as a fingerprint. General rule: static segments before
wildcard parameters.

### 6.

**Retired: `console.log` in production code is rejected by ESLint.** The rule
`no-console` (`error`, `warn`/`error` allowed) applies to `frontend/src`
(`frontend/eslint.config.js`) and runs in the pre-commit hook and CI via
`pnpm lint`. The number stays because the ESLint config cites it.

### 7.

**Retired: `cursor: pointer` on clickable elements is a global CSS rule.**
`a, button, [role="button"] { cursor: pointer }` in `frontend/src/index.css`
covers every clickable element; nothing to add per component, and never
override it. No test guards the rule itself — removing it would go unnoticed
until a review or a visual check.

### 8.

**SQLite single writer**: `SetMaxOpenConns(1)` + WAL mode — SQLite only.
PostgreSQL uses a **capped** pool (`JARVIS_DB_MAX_OPEN_CONNS`, default 10,
MaxIdle = MaxOpen) — never unbounded (it exhausted RDS connection slots in
production) and never `SetMaxOpenConns(1)`.

### 9.

**`JARVIS_DB_DSN` never logged raw**: `db.RedactDSN()` must wrap the DSN
before any log call. Password stays out of logs.

### 10.

**`rebind()` in `history/store.go`**: All SQL queries use `?`
placeholders — `rebind()` converts them to `$N` for PostgreSQL at call
time. Never write `$1` literals directly in query strings.

### 11.

**CORS/WS Origin**: No wildcard `*`. `JARVIS_ALLOWED_ORIGINS` is used as
allow-list for both HTTP CORS and the WebSocket upgrade.

### 12.

**Silence-matching semantics must mirror Alertmanager, not UI-filter
semantics**: whether a silence *covers* an alert (affected-alerts preview,
overlap detection, expired-silence lookup) is decided only by
`silenceWouldMatchAlert` / `silenceMatchesAlert` (`lib/alertUtils.ts`) —
anchored regex (`anchoredRegex`, `^(?:pattern)$`, like Alertmanager's
RE2) against the alert's real labels only, no `@cluster`/`@receiver`/
`receiver` pseudo-labels. `matchesLabelMatchers` (substring regex,
pseudo-labels, comma-list receivers) is the deliberately lenient
filter-bar function — never use it for silence coverage (mixing
them showed "0 affected alerts" while Alertmanager silenced alerts;
`.agents/lessons/silences-and-settings.md`).

### 13.

**Client-facing read endpoints never call Alertmanager synchronously.**
Reads are served from poll snapshots (`AlertStore`, `SilenceStore`,
cached member up-state); only the recorder poll and explicit user
mutations (silence create/delete) go upstream — otherwise AM load scales
with open browser tabs (live proxying in `getSilences`/`getClusters`
roughly doubled AM CPU in a real deployment; `.agents/lessons/history-and-ha.md`).

### 14.

**A failed cluster fetch must never trigger resolves.** Its last
successful snapshot stays authoritative — for alerts
(`Recorder.lastGoodAlerts`) as for silences (`SilenceStore` snapshots
only on success). Otherwise `applyPollResults` diffs zero alerts as mass
resolves: phantom `resolved` events, wrong `occurrence_count`, premature
claim releases (`.agents/lessons/history-and-ha.md`).

### 15.

**History side effects and Alertmanager polling are leader-only on
PostgreSQL** (`docs/postgres-ha.md`). Exactly one pod (advisory lock,
`internal/leader`) polls and writes history:
`RecordStatusChange`/`RecordResolvedForCluster`, occurrence counts, delayed claim releases, `reconcileStartupResolves`,
external-silence events, retention sweeps (`history.Recorder.IsLeader()`,
`retention.Sweeper.shouldSweep()`). Followers serve reads/API/WS from the
leader's `poll_snapshots` (`internal/history/recorder_snapshot.go`), never
from an own poll. On SQLite `StaticElector` is always leader — same code
path, no gate.

### 16.

**`RecordStatusChange` stays transactional and, on PostgreSQL,
advisory-xact-locked per episode.** Read-last → grace-delete → insert →
count-update runs in one `Store.withTx`; on PostgreSQL it first sets
`lock_timeout = '10s'`, then takes
`pg_advisory_xact_lock(hashtext(fingerprint || ':' || cluster_name))` —
otherwise concurrent pods insert duplicate event rows (SQLite is already
serialized by `SetMaxOpenConns(1)`). `withTx` also caps every history
transaction at `txTimeout` (30s) regardless of the caller's context — a
peer stuck on the lock must never stall the sequential poll loop
(`.agents/lessons/history-and-ha.md`).

### 17.

**`AlertStore.Get()` returns a deterministically ordered snapshot**:
`startsAt` desc, then `fingerprint` asc, then `clusterName` asc
(`internal/history/alert_store.go`) — a total order over unstable
upstream order and the resolved-buffer map. `GET /api/v1/alerts`,
`/api/v1/alerts/groups` and WS `alerts_update` pass it straight through
and the frontend keeps incoming order, so an unsorted read path makes
rows flicker on every poll (`.agents/lessons/api-auth-ws.md`). Never re-introduce an
unsorted alert-list read path.

### 18.

**Every pod's in-memory `AlertStore` must reflect a claim the instant it
is broadcast — not just the originating pod's.** `claims.go` patches its
own `AlertStore` (`SetActiveClaim`/`ClearActiveClaim`) and fans
`claim_set`/`claim_released` out; receiving pods (`HandleFanoutMessage` /
`HandleFanoutRef` → `applyClaimSideEffect`, `internal/api/fanout_dispatch.go`) must apply the **same** patch, not only
re-broadcast. The post-mutation refetch of `GET /api/v1/alerts` lands on
any pod (invariant #13), so a pod without the patch makes the claim
flicker out and back (`.agents/lessons/history-and-ha.md`). PostgreSQL multi-replica
only; the patch is unconditional (NoopFanout never delivers).

### 19.

**Label display configuration is display-only.** `labelDisplay.order`
(pinned) / `labelDisplay.hidden` and `labelColors` (`useSettingsStore`)
may only affect which chips `partitionLabelsForDisplay`
(`lib/alertUtils.ts`) emits for card and list views — incl. the per-alert
"+N" chip (`HiddenLabelsToggle`, `components/alerts/LabelChip.tsx`), whose
reveal state is local and never writes back to settings — and how
`labelColorStyle` paints them. They
must never reach `getFilterableLabels`, `matchesLabelMatchers`,
`silenceWouldMatchAlert`/`silenceMatchesAlert`, the affected-alerts
preview, `findRelatedAlerts`, or the detail panel's Labels section — a
hidden label is invisible, not absent (same bug class as #12).

### 20.

**Settings migrations run before normalization drops unknown keys, and
stay.** `normalizeSettings` (`lib/settingsUtils.ts`) keeps only known
keys and validates the shape of every nested value (a `labelDisplay`
missing `order`, for example, is dropped rather than kept partial), so a
removed/renamed setting or a malformed value is silently gone unless its
migration runs first: `migrateLegacyDefaultFilters` at the top of
`normalizeSettings` itself, which both the server read path and
`migratePersistedSettings`'s pre-v2 branch (zustand `persist` migrate —
the localStorage path) call before `diffFromDefaults`, which only walks
`DEFAULT_SETTINGS` keys and does no shape validation of its own. Never
diff a raw persisted blob directly — always through `normalizeSettings`
first, or a malformed nested field survives into `overrides` and crashes
whatever reads it unconditionally (`partitionLabelsForDisplay`'s
`config.order.indexOf(...)` on a `labelDisplay` without `order`,
`.agents/lessons/silences-and-settings.md`). Server rows are never rewritten, so a legacy-key
migration stays while rows from older releases may exist.

### 21.

**Globally mounted browser hooks never load unbounded database history
merely to compute a count.** When needed, history counts are SQL
aggregates; history lists are paginated or streamed, and request
cancellation propagates to the database.

Tests cover only the backend half: `TestVisitResolved_ContextCancellationStopsIteration`,
`TestVisitResolved_PostgresCancellationReleasesConnection` (cancellation
reaches the database) and `TestGetResolvedPage_*` (paged reads). Nothing
guards the "no globally mounted hook computes a count from a full list" half;
that stays a review duty.

### 22.

**Every live resolved-buffer entry expires with its own episode after 20
minutes on leaders and followers.** Re-ingesting the same episode never
extends its deadline; a genuine re-fire/new resolve gets a new deadline.
The central sweep removes follower-cache references too, but never active
last-good alerts or persistent database history.
