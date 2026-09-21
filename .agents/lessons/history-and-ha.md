# Jarvis Lessons — History, recorder, grace period, PostgreSQL HA

Alert episodes, resolves, occurrence counts, claims across replicas, leader/follower behaviour, DB pools, poll load. Part of the lessons reference — start at `.agents/lessons.md` (index). Newest first; entry format: symptom → cause → rule.

---

## A peer holding the per-episode advisory lock indefinitely stalled the whole poll loop — history writes need a deadline

**Symptom**: On PostgreSQL, a pod could stop polling entirely — no further
polls, no `poll_snapshots` updates, no WS broadcasts — and not even shutdown
unblocked it.
**Cause**: `RecordStatusChange` and `RecordResolvedForCluster` run on
`context.Background()` and take the per-episode
`pg_advisory_xact_lock(hashtext(fingerprint || ':' || cluster_name))`
(Critical Invariant #16). A peer holding that lock indefinitely (a hung pod, a
transaction stranded by a network partition) blocked the call forever, and
since it runs sequentially in `applyPollResults`, the entire poll loop stalled
with it. The lock itself exists because two pods (or two connections during a
rolling update) racing the same fingerprint could otherwise both read the same
"last event" before either commits and both insert — duplicate event rows.
**Rule**: `Store.withTx` bounds every history transaction to `txTimeout` (30s)
regardless of the caller's context, and on PostgreSQL the transaction sets
`lock_timeout = '10s'` as its first statement. Never run a history write
without a deadline on the poll path.

---

## Hourly PostgreSQL LISTEN reconnects and occasional single-poll 503s are expected noise, not bugs — but they were logged loud enough to trip infra error-count alerting

**Symptom**: Production (2-replica, PostgreSQL) logs showed `fanout:
connection lost, reconnecting` / `listen: connection lost, reconnecting`
(`err":"unexpected EOF"`) on a near-exact ~60-minute cadence per pod, plus
occasional `fetch silences failed ... alertmanager returned 503 ...
upstream connect error or disconnect/reset before headers` for one cluster
every few hours. Both were logged at `Warn`, and the infra's log-based
alerting fired once enough of these accumulated — even though neither
represented a real outage.
**Cause**: The per-connection survival pattern in the logs pins it down to
an **application-idle timeout of exactly 1h that TCP keepalives don't
reset**: the leader pod lost its `fanout` (jarvis_ws) *and* `listen`
(jarvis_trigger) connections hourly — both channels are silent unless a
user mutates something; the follower lost *only* `fanout` — its snapshot
LISTEN receives a NOTIFY every poll interval (real payload) and survived;
the elector connections (a real query every 5s) never dropped, so
leadership never flapped. The aggressive TCP keepalives (5s idle/3s
interval/3 count, D2) were flowing on all of them, so whatever killed the
idle ones counts only application data, not TCP-level keepalive ACKs —
and Envoy's TCP-proxy default `idle_timeout` is exactly 1 hour, with the
mesh already proven in the path (see below). "unexpected EOF" = an active
close, not a silent drop; keepalives tuned for silent failures can't
prevent it. Separately, the 503 came from an Envoy/Istio-shaped error
string ("upstream connect error … reset reason: connection termination"),
i.e. a service-mesh sidecar in front of that cluster's Alertmanager
occasionally resetting a connection — a one-off blip, not a sustained
failure, but `FetchAlerts`/`FetchSilences` had no retry on the read side
(only the write path, `CreateSilence`/`DeleteSilence`, retried on a
5xx/transport error). Related latent bug found while fixing this: the
write path's 4xx/5xx distinction never worked for reads because
`alertmanager.Client.get` returned a plain `fmt.Errorf` for non-2xx —
only the write methods built `*AMError`. `get` now returns `*AMError`
too, so `isRetryableUpstreamError` can actually see the status code.
**Rule**: A reconnect loop that already self-heals immediately (the `Run`/
`listenLoop` loops in `internal/fanout/postgres.go` and
`internal/history/recorder_snapshot.go` redial and re-`LISTEN` right away)
doesn't need `Warn` — logged at `Info`, still visible on inspection, no
longer countable as an "error" by naive log-volume alerting. For upstream
reads, apply the same retry-once policy the write path already had:
`isRetryableUpstreamError` (renamed from `isRetryableWriteError` — it now
covers both) gates one immediate retry (`fetchRetryDelay`, 250ms) in
`Cluster.FetchAlerts`/`FetchSilences` before a per-member failure counts —
see `.agents/architecture.md`. General principle: log level should track
*operator actionability*, not just "an error occurred" — a self-healing
retry loop and a transient blip that a one-shot retry absorbs are both
"nothing wild," and treating them as `Warn`/`Error` just teaches the infra
alerting (and the on-call human) to ignore real signals mixed in with them.
Open option if the hourly reconnects should disappear entirely instead of
being tolerated: send real payload on the idle LISTEN connections (a
periodic `SELECT 1`/Ping between `WaitForNotification` calls — the
snapshot listener's survival proves payload resets the timer), or raise
the mesh sidecar's idle timeout for the PostgreSQL egress. Tolerating them
is safe for `listen:` (trigger misses only delay reconciliation to the
next poll; snapshots have the periodic-resync fallback), and near-safe for
`fanout:` (fire-and-forget, no resync — a WS mutation broadcast landing in
the sub-second redial window is lost until the browser's next refetch).

---

## Go's default database/sql pool is unbounded — it exhausted RDS connection slots in production

**Symptom**: `stats`/`heatmap` requests returned 500 with
`FATAL: remaining connection slots are reserved for roles with privileges
of the "pg_use_reserved_connections" role (SQLSTATE 53300)` — the RDS
instance had no free connection slots left, across multiple pods at once.
**Cause**: `openPostgres` never configured the pool. `database/sql`
defaults are `MaxOpenConns=0` (unlimited) and `MaxIdleConns=2`: every
request burst opened as many connections as there were parallel queries,
then closed almost all of them again (churn), multiplied by the number of
pods — until the server's `max_connections` was gone. SQLite never hits
this because invariant #8 forces `SetMaxOpenConns(1)`.
**Rule**: Never ship a `database/sql` pool with default settings against a
shared PostgreSQL. Cap it (`JARVIS_DB_MAX_OPEN_CONNS`, default 10) and set
`MaxIdleConns = MaxOpenConns` so bursts reuse connections instead of
churning them. Full sizing guidance (leader-election + fanout connections,
reserved slots): `docs/postgres-ha.md → Connection-pool cap`.

---

## A fixed 60s grace period can't absorb a missed poll once the poll interval itself is ≥ 60s

**Symptom**: Not yet observed in production — found by inspection while
auditing the grace period (Critical Invariant #1). `RecordStatusChange`'s
grace window was a hardcoded 60 seconds, but `JARVIS_POLL_INTERVAL` is a
user-configurable duration with no upper bound enforced.
**Cause**: The grace period exists specifically to absorb *one missed poll*
between a genuine resolve and its immediate re-fire (so a single dropped
poll cycle doesn't permanently split one episode into two). If the poll
interval itself is configured at or above 60 seconds, a single missed poll
can by definition never fit inside a fixed 60s window — the mechanism the
invariant is supposed to provide stops working exactly when polls are
sparse enough to need it most.
**Rule**: The grace period must scale with the poll interval, not be a
fixed constant. Fixed via `Store.SetGracePeriod` (`store.go`), set in
`cmd/jarvis/main.go` to `max(60s, 2×JARVIS_POLL_INTERVAL)`.
`Recorder.claimReleaseDelay` (now a `NewRecorder` parameter instead of a
hardcoded 20 minutes) is derived alongside it to stay comfortably above the
grace period — see Critical Invariant #1 in `AGENTS.md`. Any other
hardcoded constant that exists to absorb "one poll cycle" of slack should
be checked against the same scaling requirement.

---

## Per-alert resolved timers confused episode identity and retained stale startup/follower data

**Symptom**: Resolved entries loaded at startup could remain for the entire
process lifetime, followers could retain them in cached snapshot slices, and
resolve A → re-fire → resolve B let A's timer remove B too early because the
timer knew only fingerprint+cluster. Large bursts also created one sleeping
goroutine per resolved alert.
**Cause**: The display TTL was represented by detached goroutines instead of
episode data. The seven-day seed scheduled no timers, and follower snapshots
formed a second owner outside `AlertStore.resolvedBuffer`.
**Rule**: Store the absolute deadline with the resolved episode. One
process-context sweeper expires deadlines from both `AlertStore` and follower
caches; repeated ingestion preserves the original deadline, while a genuine
refire/new resolve creates a new one. Seed only the still-live 20-minute
window, and select the latest event before filtering for `resolved`, otherwise
an older resolve can survive a later firing. TTL cleanup never touches active
last-good alerts or persistent history.

---

## A Jarvis restart during an alert's downtime resolve permanently swallowed its next re-fire

**Symptom**: An alert that fired, then genuinely resolved while Jarvis
happened to be restarting, never got a `resolved` row in the DB. Its next
real fire didn't create a new history/heatmap entry either — the alert just
looked stuck in `firing` forever, quietly, until some unrelated later event
touched it.
**Cause**: The poll diff in `applyPollResults` only ever compares against
`Recorder.prevSnapshot`, which is pure in-memory state. A fresh process
starts with an empty `prevSnapshot`, so the first poll after a restart has
nothing to diff against — an alert that vanished from Alertmanager during
the downtime just silently stops appearing, with no "missing from curr"
detection possible. The DB's last event for that `(fingerprint, cluster)`
stays whatever it was before the restart (typically `firing`). When the
alert fires again later, `RecordStatusChange`'s idempotency check
(`last.Status == status` → no insert) treats it as an unchanged, still-open
episode instead of a new one.
**Rule**: See Critical Invariant #14's sibling fix in `AGENTS.md` /
`reconcileStartupResolves` — DB state, not just in-memory `prevSnapshot`,
has to be consulted once at startup. Any future "recorder decides lifecycle
purely from `prevSnapshot`" logic needs the same startup bootstrap or it
will repeat this gap after every restart, not just occasionally.

---

## A cluster's failed alert fetch was diffed as if every one of its alerts had resolved

**Symptom**: The silence-fetch path already had a "snapshot only on a
successful fetch" guard (`poll()` in `recorder.go`), but the equivalent
alert-fetch path didn't. A cluster whose `FetchAlerts` fails (all HA members
down, or the only member down for a single-member cluster) simply
`continue`d past that cluster for the poll — its alerts were absent from
`allAlerts` entirely.
**Cause**: `applyPollResults`'s prev/curr diff treats "alert present in
`prevSnapshot` but missing from the current poll" as resolved — the
mechanism that correctly detects a real resolution can't distinguish "alert
actually gone" from "we simply failed to ask this cluster this time". Below
the 60s grace period a single missed poll self-heals (re-fire cancels the
phantom resolve); at or above it, the DB gets permanent bogus
resolved+firing pairs (`occurrence_count` increments, claim releases fire,
and the alert visibly greys out in the UI for a poll cycle even in the
sub-60s case).
**Rule**: See Critical Invariant #14 in `AGENTS.md`. Fixed by
`Recorder.lastGoodAlerts` (`recorder.go`) — a cluster's alerts from its last
*successful* fetch are reused whenever the current fetch fails, so the diff,
`AlertStore`, WS broadcast (hash unchanged → no broadcast), and claim logic
all see a stable snapshot for a cluster that's merely unreachable, not
resolved. Applies mainly to single-member clusters and genuine total
outages, since `FetchAlerts` only errors when every HA member fails.

---

## A silence expiring mid-episode replays as a "new" firing row with the same `starts_at` — double-counts the heatmap

**Symptom**: `GetFiringStarts` (`backend/internal/history/store.go`) was
believed safe from double-counting because "the 60s grace period already
prevents it" (old code comment). That's only true for resolve+refire.
**Cause**: When a silence expires (or is deleted) while the alert is still
actually firing in Alertmanager, the poll sequence is `suppressed →
expired (poll N) → firing (poll N+1)` — the new firing row is written
because the *last* event was `expired`, not `firing` (idempotency only
skips inserts when the immediately preceding status matches). That new row
carries the *same* `starts_at` as the original episode (AM never actually
stopped firing), so one real firing episode produced two rows with
status `firing` — `GetFiringStarts` counted both, double-counting the
episode in the heatmap. The same pattern hits the grace-period edge case
too, when the row immediately before a `resolved` row was `suppressed`.
**Rule**: Episode identity for firing-episode dedup is `starts_at`
(Alertmanager's upstream condition-start time), not "one row per firing
status change". `GetFiringStarts` now groups by `starts_at` (via a
`ROW_NUMBER() OVER (PARTITION BY starts_at ...)` subquery — a plain
`GROUP BY` + `MIN(recorded_at)` fails on SQLite because aggregate
expressions lose the column's declared `DATETIME` type, so
`modernc.org/sqlite` scans the result as a string instead of `time.Time`;
selecting the raw `recorded_at` column through a window-function subquery
preserves it). `occurrence_count` and `GetStatsForCluster`'s per-cluster LAG
query are unaffected — they only count firing-after-resolved transitions.

---

## A resolve+refire inside the 60s grace period is silently absorbed, not recorded

**Symptom**: Manually testing occurrence tracking / the firing-pattern
heatmap by running `make fixtures-remove` then `make fixtures-create` —
even with an explicit `POST /api/v1/poll` forced in between and a few
seconds' wait — `occurrenceCount` and the heatmap stayed completely
unchanged, with zero trace of a resolved event ever appearing in
`GET /alerts/:fp/history`, even though Alertmanager's own `GET /api/v2/alerts`
confirmed the alert genuinely disappeared and came back with a fresh
`startsAt`. (First suspected: poll-interval racing, or Alertmanager gossip
lag between the dev HA pair's two members — both ruled out by direct testing:
the resolve is immediate at the Alertmanager API level, and AM does not
gossip raw alert data between mesh members at all, only silences/nflog, so
member-lag was never the mechanism.)
**Cause**: This is Critical Invariant #1 (`AGENTS.md`) doing exactly what
it's designed to do. `RecordStatusChange` (`backend/internal/history/store.go`):
a firing status arriving within 60s of the last recorded *resolved* row
**deletes that resolved row** and returns the prior (still-firing) row
unchanged — `created=false`, no new event, `occurrence_count` untouched.
This exists to stop a transient poll miss from creating ghost-resolve
entries. `resolve-test-alerts.sh` resolves in well under a second; unless
something deliberately holds the alert resolved for >60s before re-firing,
any test re-fire lands inside the grace window and is invisibly discarded —
regardless of `JARVIS_POLL_INTERVAL`, and regardless of whether a poll was
forced in between.
**Rule**: To manually force a genuine new firing episode, resolve, then
wait **more than 60 seconds** before re-firing — `make fixtures-refire`
(`scripts/refire-test-alerts.sh`, `GRACE_WAIT_SECONDS=70`) does this. There
is no way to shortcut this with faster polling; the wait is the fix.

---

## Per-client live proxying to Alertmanager makes AM load scale with open tabs

**Symptom**: Alertmanager CPU roughly doubled on one environment after
deploying Jarvis — most visible on the instance with the largest
alert/silence payload.
**Cause**: `GET /api/v1/silences` (fetch from every cluster member) and
`GET /api/v1/clusters` (live `/api/v2/status` ping per member) proxied to
Alertmanager on **every client request**, and the frontend refetches both
every 30s in every open tab. Each tab added ~4 AM requests/min per member on
top of the recorder poll — the intended "only the backend polls, clients get
snapshots/WS" architecture was silently broken for these two endpoints.
**Rule**: Critical Invariant #13 — client-facing reads are served from poll
snapshots (`AlertStore` / `SilenceStore` / `MemberUpStates`), never from a
synchronous AM call. Mutations write through to the snapshot + trigger a
poll so the UI stays instant. When adding a read endpoint, ask: "does its
cost scale with the number of open tabs?" — if yes, snapshot it.

---

## Followers dropped a fresh claim until the leader's next poll (multi-replica)

**Symptom**: On a multi-replica PostgreSQL deployment, claiming an alert
showed the claim banner in the UI for a moment, then it disappeared, then it
came back on the next poll cycle — repeatably.
**Cause**: `claims.go` patches the handling pod's in-memory `AlertStore`
(`SetActiveClaim`) and fans the `claim_set` WS event out to every pod, so the
claim shows immediately. But a follower rebuilds its whole `AlertStore` from
the leader's persisted `poll_snapshots` row on every `jarvis_snapshot`
NOTIFY / idle resync (`rebuildFollowerAlertStore` → `AlertStore.Set`). That
snapshot only contains the claims that existed as of the leader's **last**
poll, so the rebuild overwrote the just-patched claim with `nil` and
broadcast an `alerts_update` without it. The leader's next poll re-attached
the claim from the DB (`applyPollResults` → `GetActiveClaims`) and persisted
a fresh snapshot, so it reappeared.
**Rule**: `rebuildFollowerAlertStore` re-hydrates `ActiveClaim` from the
shared DB (`Store.GetActiveClaims`, the same batched read the leader runs)
before `AlertStore.Set` — claims are authoritative from the DB, not the
snapshot (a since-released claim in a stale snapshot is cleared too). When a
follower serves derived state that a mutation can change between leader
polls, ask whether the snapshot alone can carry it or whether the follower
must read the authoritative table.

**Follow-up (still flickered after the fix above)**: the rebuild fix closed
the *broadcast* path but not the *REST read* path. A claim mutation's
success handler immediately refetches `GET /api/v1/alerts`, and that XHR is
not sticky — it load-balances onto any pod, often a **non-originating**
follower whose `AlertStore` the cross-pod fanout never patched (the fanout
receiver only re-broadcast the `claim_set` WS event to that pod's clients).
That pod served a claim-less `alertStore.Get()` and React Query wrote it
over the just-shown claim; it reappeared on that pod's next snapshot
rebuild. **Fix**: `HandleFanoutMessage` / `HandleFanoutRef` now apply the
same `SetActiveClaim`/`ClearActiveClaim` patch every receiving pod, mirroring
`claims.go` on the origin pod (`applyClaimSideEffect`, Critical Invariant
#18). General rule: when a mutation patches local in-memory state **and**
fans a WS event out, the fan-out receivers must apply the identical local
patch — re-broadcasting the event alone leaves every other pod's read path
stale until its next poll.
