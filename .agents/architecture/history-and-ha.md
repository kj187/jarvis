# Jarvis Architecture — History, Retention, Leader Election, HA

Part of the architecture reference — start at `.agents/architecture.md` (index). Base rules and critical invariants live in the root `AGENTS.md`; when this file contradicts the code, the code wins.

---

## Alert Lifecycle State Machine

![Alert lifecycle state machine](../docs/assets/alert-lifecycle.svg)

(source: `docs/diagrams/alert-lifecycle.mmd`, re-render via `make diagrams`)

Full user-facing lifecycle reference — episodes/`starts_at`, grace period,
resolved buffer, claim auto-release, startup reconciliation, fetch-failure
guarantees: `docs/alert-lifecycle.md` (keep it in sync with lifecycle
changes like every other doc).

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

---

## Data Retention Sweeper (`internal/retention`)

Optional, env-var-only background deletion of old rows — user-facing docs:
`docs/retention.md`; config: `Config.Retention` (`internal/config`, variables in `docs/configuration.md`).

- `Sweeper` (`sweeper.go`), built via `retention.NewSweeper(store,
  cfg.Retention, logger, m)` in `main.go`, started as `go
  sweeper.Start(ctx)` alongside `recorder.Start(ctx)`. Its `store` param is
  a small interface (not `*history.Store` directly) so it's testable
  without a DB — `*history.Store` satisfies it structurally.
- `Start` is a **no-op** when `cfg.Retention.Enabled()` is `false` (the
  default) — no timer, no query, ever. Otherwise the first sweep runs 1
  minute after `Start` (doesn't compete with boot), then every
  `cfg.Retention.SweepInterval`.
- `sweep()` runs domains in FK-safe order: comments (if
  `EffectiveCommentsDays() > 0`) → released claims → silence events →
  detach comment/claim survivors from soon-to-be-deleted events → events →
  orphan fingerprints last (cutoff = the **widest** of all four effective
  retentions, since a fingerprint may only vanish once nothing anywhere
  still references it). One domain's error is logged and does **not**
  abort the others.
- `history/store_retention.go` holds the six store methods the Sweeper
  calls, all batched (500 rows, `batchDeleteLoop`, short pause between
  batches — Critical Invariant #8, SQLite single writer) and
  context-cancellable:
  `DeleteSweepableEventsBefore`, `DetachCommentsAndClaimsFromSweepableEventsBefore`,
  `DeleteReleasedClaimsBefore`, `DeleteCommentsBefore`,
  `DeleteSilenceEventsBefore`, `DeleteOrphanFingerprintsBefore`.
- `sweepableEventsCondition` (shared SQL fragment, same file) decides which
  `alert_events` rows are safe to delete: the episode is already closed
  (`resolved`/`expired`), OR a newer event exists for the same
  `(fingerprint, cluster_name)` (this row is superseded). It deliberately
  does **not** use `ends_at` — no INSERT ever writes it, it's always NULL —
  and never matches the newest row of a still-`firing`/`suppressed`
  episode, however old, since the recorder only writes rows on status
  *changes*.
- Metrics: `jarvis_retention_sweeps_total`,
  `jarvis_retention_deleted_rows_total{table}`,
  `jarvis_retention_sweep_duration_seconds` (`docs/metrics.md`).
- Known accepted side effect: a fingerprint's **global** `occurrence_count`
  survives event deletion (lives on `alert_fingerprints`), but **per-cluster**
  stats/heatmap are derived live from `alert_events` and shrink to the
  retention window after a sweep. If a fingerprint survives only via a
  surviving comment and later re-fires, `RecordStatusChange` finds no prior
  event and does not increment `occurrence_count` (also doesn't reset it).

---

## Leader Election, Snapshot Distribution, Fanout (`internal/leader`, `internal/fanout`)

The design, the numbers (retry/heartbeat interval, keepalive, the 200 ms burst
window, the ~8000-byte NOTIFY limit, queue bounds) and the failover behavior
are owned by `docs/postgres-ha.md`; the constants live next to the code. This
section is only the code map and what the prose there does not tell you. Read
`docs/postgres-ha.md` first for the *why*.

### Leader election (`internal/leader`)

- `Elector`: `IsLeader()`, `Run(ctx)`, `Subscribe(fn func(isLeader bool))`.
  `Subscribe` (not a channel) because there are several independent consumers;
  callbacks run sequentially on the elector's goroutine and **must not block**.
  It fires immediately with the current state, so the initial `false` before
  `Run` acquired anything means "not leader (yet)", not "just demoted".
- `StaticElector` (SQLite) is always leader. `PGElector` (PostgreSQL) holds
  `pg_try_advisory_lock` on a dedicated connection, never the pool. Test-only
  overrides `SetLockID` / `SetRetryInterval`: each PG-backed elector test gets
  its own lock namespace so test binaries do not serialise on the shared DB
  (`.agents/lessons/testing-and-e2e.md`); production uses the constants.
- Wiring in `cmd/jarvis/main.go`: `db.DetectDialect` picks the elector, always
  on with PostgreSQL (no escape-hatch env var).
- `history.Recorder` and `retention.Sweeper` each hold a narrow local elector
  interface, so `history` does not import `internal/leader`. A `nil` elector
  means "always leader" — the default for every test that builds a `Recorder`
  directly.
- Leader-only side effects are the list in Critical Invariant #15. The delayed
  claim release re-checks `IsLeader()` at fire time (leadership can change
  during `claimReleaseDelay`). `reconcileStartupResolves` is guarded per
  cluster by `reconciledClusters`, which a follower never marks — so the first
  poll after a promotion (triggered by the promotion hook) reconciles exactly
  once. Not gated: `AlertStore`/resolved-buffer bookkeeping and WS broadcasts.
- `jarvis_leader` is set from `Recorder.onLeadershipChange`; `GET /api/v1/status`
  reports `"leader"` through the `pollTriggerer` interface.

### Leader-only polling and snapshot distribution (PostgreSQL only)

Code: `internal/history/recorder.go`, `recorder_snapshot.go`.

- SQLite, or a `Recorder` built without elector/DSN (most unit tests), always
  runs `runPollLoop`. On PostgreSQL `runModeSupervisor` switches between
  `runPollLoop` (leader) and `runFollowerLoop` (follower). The elector callback
  only replaces the single pending request in a size-1 channel and returns
  (the non-blocking contract); the supervisor is the only place that cancels
  the previous mode **and waits for its goroutine** before starting the next,
  so a demoted leader's in-flight write can never overlap a follower rebuild.
  `runModeSupervisorWith(...)` takes the two modes as functions so tests use
  fakes without PostgreSQL.
- `poll()`/`applyPollResults()` check `ctx.Err()` before each DB write and
  before the final `AlertStore.Set` / broadcast / `persistSnapshots`: a poll
  cancelled by a mode change must not publish a stale result.
- Leader: `persistSnapshots` writes `{alerts, silences, memberUp}` per cluster
  into `poll_snapshots` (`Store.PersistSnapshot`) and `pg_notify`s
  `jarvis_snapshot`; no-ops on SQLite.
- Follower: `resyncAllSnapshots` on start, then `listenLoop` (marks a
  `followerDirtySet` only — no decode on the LISTEN goroutine),
  `runFollowerBatchWorker` (fixed `followerBurstWindow`, one `AlertStore`
  rebuild per burst) and `runFollowerResyncTicker` (a full resync every
  `JARVIS_POLL_INTERVAL`, independent of notification traffic — the old
  `onIdle` fallback could be starved by other clusters' notifications).
  `rebuildFollowerAlertStore` re-merges every cluster (`AlertStore.Set` always
  replaces the whole store) and re-hydrates `ActiveClaim` from the DB
  (`Store.GetActiveClaims`): claims are authoritative from the DB, not from
  the snapshot. Resolved alerts are normalized to the earlier of `EndsAt` and
  the row's `takenAt`; the shared sweeper clears them from `AlertStore` and the
  cached follower slice (Invariant #22).
- Followers report cluster health from `followerSnapshots` in
  `Recorder.ClusterUpStates()`. `rebuildFollowerAlertStore` sets
  `jarvis_snapshot_stale` (snapshot older than 3× `JARVIS_POLL_INTERVAL`); a
  promotion resets it.
- `Recorder.Trigger()`: leader → `triggerLocal`; follower → `Store.NotifyTrigger`
  (`pg_notify`, `jarvis_trigger`), which the leader's `runPollLoop` listener
  turns into a local trigger.
- `listenLoop`/`dialListener`/`consumeNotifications` are Recorder-local: a
  dedicated (non-pooled) `pgx.Conn` per LISTEN, reconnecting with a fresh
  LISTEN on connection loss.
- Multi-replica harness: `internal/history/recorder_multireplica_test.go`
  (`JARVIS_TEST_POSTGRES_DSN`-gated) runs two real `Recorder`s with real
  `PGElector`s against one database, including a leader kill and a
  resolve+refire straddling the handoff (Invariant #1).

### Cross-pod WS mutation fanout (`internal/fanout`, PostgreSQL only)

Only mutation-driven broadcasts (comment, claim, silence via the API) are
fanned out; poll-driven `alerts_update` and `silences_update` are not — every
pod derives those from its own poll or snapshot.

- `Fanout`: `Publish(ctx, message, ref)`, `Run(ctx, onMessage, onRef)`.
  `Ref{Type, Fingerprint, ClusterName, ID}` lets the receiver re-read the row.
  `NoopFanout` (SQLite) does nothing; `PGFanout` publishes via
  `pg_notify('jarvis_ws')` on the pooled `*sql.DB` and listens on its own
  connection. The envelope is `{origin, message?, ref?}`; `origin` is a random
  per-instance id and `consume` drops its own — NOTIFY is delivered to the
  sending session too. Fire-and-forget: a missed NOTIFY skips one live update,
  the next refetch converges.
- Oversized envelopes (`maxNotifyPayloadBytes`, reachable with `comment_added`)
  go out as `ref` only; the receiving `onRef` refetches and rebuilds the same
  broadcast.
- Sender: `api.Server.broadcastAndFanout(ctx, eventType, payload, ref)` is the
  single call site of every user-mutation handler (`comments.go`, `claims.go`,
  `applySilenceWriteThrough` in `silences.go`): build once, `Hub.BroadcastRaw`
  locally, `fanout.Publish`. Silence templates have no WS broadcast.
- Receiver: `api.HandleFanoutMessage` (re-broadcast unchanged) and
  `api.HandleFanoutRef` (`comment_added` → `GetComment`, `claim_*` →
  `GetActiveClaim`, `silences_update` → re-broadcast), wired in `main.go` next
  to the elector/recorder/sweeper goroutines. Both also patch the local
  `AlertStore` via `applyClaimSideEffect` (`fanout_dispatch.go`, Invariant #18).
- `ws.Hub`: `BuildEventJSON` (encode only), `BroadcastRaw`, `BroadcastTyped`
  (records `jarvis_ws_broadcasts_total` under the fixed `metricEventType` set —
  an unknown type maps to `unknown`, never an unbounded label). `Recorder`
  calls `BroadcastTyped` with an envelope wrapped around
  `AlertStore.EncodedSnapshot()` — never a second `json.Marshal` of the list.
- Per-client queue (`Client.enqueue`/`drain`): `alerts_update` is coalesced to
  one slot (`snapshotIdx`; a newer one overwrites in place, keeping its position
  relative to discrete events); discrete events (`claim_*`, `comment_added`,
  `silences_update`) are never merged or dropped and are bounded by
  `discreteBuffer`. `Hub.Run` disconnects a client only when its **discrete**
  backlog is full, closing the socket after releasing the hub lock; before
  coalescing, one snapshot burst disconnected every client at once
  (`.agents/lessons/api-auth-ws.md`).
- Harness: `internal/fanout/postgres_test.go` and
  `internal/api/fanout_integration_test.go` (two pods, one database; inline and
  ref-fallback paths), both `JARVIS_TEST_POSTGRES_DSN`-gated.

### Leader pod label (`internal/leader.PodLabeler`, Kubernetes only)

Informational (`kubectl get pods -L jarvis.kj187.de/role`); no leader-only
routing exists. Registered in `main.go` as an `Elector.Subscribe` callback.

- Merge-patch (`application/merge-patch+json`) of the pod's own labels; step-down
  patches the key to `null` (never fails when `metadata.labels` is absent).
  `hasLabel` prevents a pointless remove when the initial `Subscribe` call fires
  `false`.
- Plain `net/http` with the ServiceAccount CA and token — no client-go — plus
  `POD_NAME`/`POD_NAMESPACE`. It disables itself (logs why) without the token
  file or those variables; a failed PATCH is logged, never fatal.
- Chart: `rbac.yaml` (`Role` `pods: get, patch` only), gated by
  `leaderElection.podLabel.enabled`; the ServiceAccount has
  `automountServiceAccountToken: false`, so `deployment.yaml` re-enables it at
  pod level with the toggle.

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
  for silences. Called only from the recorder poll, which stores the result
  in `history.SilenceStore` (in-memory snapshot per cluster, AlertStore
  pattern) — `GET /api/v1/silences` reads that snapshot and performs no
  upstream call. A failed silence fetch keeps the cluster's previous
  snapshot (never blanks the silences page on a transient error). A failed
  *alert* fetch (`Recorder.poll`, `recorder.go`) mirrors this: the cluster's
  last successfully fetched alert list (`Recorder.lastGoodAlerts`) is reused
  instead of contributing zero alerts for that poll, so a transient AM
  outage never makes `applyPollResults`'s prev/curr diff read every alert of
  that cluster as resolved (phantom resolves — false `resolved` events,
  wrong `occurrence_count` increments, and premature claim releases on the
  next re-fire).
- **Startup reconciliation** (`Recorder.reconcileStartupResolves`,
  `recorder.go`): `prevSnapshot` lives only in memory, so after a Jarvis
  restart it starts empty regardless of what actually happened in the DB
  while it was down. Without this, an alert that resolved during the
  downtime keeps a dangling non-`resolved` last event forever, and its next
  re-fire is silently swallowed by `RecordStatusChange`'s idempotency
  (`firing == firing`, no insert) — no heatmap entry, no
  `occurrence_count` bump, until some *later* cycle happens to notice. Fix:
  on each cluster's first successful fetch since the Recorder was created
  (tracked in `Recorder.reconciledClusters`, so this runs at most once per
  cluster per process lifetime), `Store.GetOpenFingerprintsForCluster`
  finds fingerprints whose latest event (within a 7-day window) isn't
  `resolved`; any not present in that first fetch's alerts get
  `RecordResolvedForCluster`'d with the startup time. The resolved
  timestamp is therefore startup time, not the real (unrecoverable) time it
  resolved during the downtime — a deliberate, documented approximation.
  The normal grace period and idempotency rules apply unchanged to whatever
  happens afterward.
- `GET /api/v1/clusters` derives member health from `Cluster.MemberUpStates()`
  — the cached up-state written by every `FetchAlerts` (≤ one poll interval
  old), never a live ping. Members without poll state yet (first interval
  after startup) count as healthy, same optimism as `writeOrder`. Cluster
  `Healthy` = any member healthy (UI shows e.g. "2/2 members up", amber when
  degraded). The former `Cluster.PingAll` live-ping helper was removed with
  this change; `alertmanager.Client.Ping` still exists but has no production
  call site.
- `Cluster.CreateSilence` / `DeleteSilence` send to the first healthy member
  (config order, from the cached up-state set by the last `FetchAlerts`),
  retrying once against the next member on transport failure or a 5xx
  response — never to all members, since gossip already replicates and
  posting to every member would create duplicates. Does NOT retry a 4xx
  (`isRetryableUpstreamError` in `poll.go`): Alertmanager already evaluated
  and rejected the request on its merits, so a second member would reject it
  identically — retrying only adds latency and, for the non-idempotent
  create, risks a duplicate if the first response was lost after
  Alertmanager had already applied the write.
- `Cluster.FetchAlerts` / `FetchSilences` apply the same
  `isRetryableUpstreamError` policy on the read side: a per-member fetch
  that fails with a transport error or 5xx gets one immediate retry (after
  `fetchRetryDelay`, 250ms) against that same member before being counted as
  a failure; a 4xx is definitive and never retried. This absorbs a single
  transient upstream blip (e.g. a service-mesh sidecar resetting the
  connection) without it ever reaching `poll()`'s error
  logging/`PollErrorsTotal` — only a fetch that fails twice in a row is a
  real, loggable problem. To make the 4xx distinction visible to reads,
  `alertmanager.Client.get` returns `*AMError` for any non-2xx (it used to
  return a plain formatted error; only the write methods built `AMError`).
  The `onDuration` metric callback reports the total fetch duration
  including a retry — deliberate, it reflects the member's true
  contribution to poll latency.
- Enrichment (`cluster/enrich.go`, `enrichMerged`) — moved here from
  `history` — builds `EnrichedAlert` (incl. `@receiver` label) from merged
  alerts; lives in `cluster` because `history` imports `cluster` (not the
  reverse). `Status.SilencedBy`/`InhibitedBy` are normalized through
  `nonNilStrings` so the API always emits JSON `[]`, never `null` — some
  Alertmanager responses omit these for an alert matching neither, which Go
  unmarshals as a nil slice, and the frontend unconditionally iterates them
  (`.agents/lessons.md`). `AlertStore.cloneEnrichedAlert`'s `cloneSlice` helper
  (`alert_store.go`) must preserve that same non-nil-emptiness through every
  `Set()` — `append([]T{}, s...)`, not `append([]T(nil), s...)`, which
  collapses a non-nil-empty source back to nil.
- History recorder keying is untouched: events stay keyed by
  `(fingerprint, cluster_name)`, since the merge happens *before* the
  recorder sees the snapshot — grace period and occurrence counting
  (Critical Invariants #1, #2) are unaffected by member count.
