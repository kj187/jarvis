# Alert Lifecycle — how Jarvis records alert history

Jarvis's core promise is a **trustworthy, persistent alert history**: every
alert's journey from first firing to final resolution is recorded as an
append-only event log in SQLite or PostgreSQL (see
[docs/persistence.md](persistence.md) for the backends themselves), and
that log survives Jarvis restarts, Alertmanager outages, and missed polls
without inventing phantom transitions. This document explains the state
machine, the rules that keep the history clean, and the guarantees (and
deliberate approximations) that apply in failure scenarios — including
across a PostgreSQL multi-replica leadership change (see
[docs/persistence.md](persistence.md#failover)).

![Alert lifecycle state machine](assets/alert-lifecycle.svg)

(source: [`docs/diagrams/alert-lifecycle.mmd`](diagrams/alert-lifecycle.mmd),
re-render via `make diagrams`)

## How Jarvis observes alerts

Jarvis never receives push notifications from Alertmanager. Instead, the
**recorder** polls every configured cluster on a fixed schedule
(`JARVIS_POLL_INTERVAL`, default 15s) and diffs each snapshot against the
previous one:

- An alert present now but absent (or differently stated) before → a new
  lifecycle **event** is recorded.
- An alert present in the previous snapshot but missing from the current one
  → it is recorded as **resolved** (Alertmanager drops alerts from its API
  when they stop firing; there is no explicit "resolved" signal to read).

Because the *absence* of an alert is what signals resolution, everything
below is designed around one question: **when is a missing alert really
resolved, and when is it just a polling artifact?**

## States and events

Each alert instance is identified by `(fingerprint, cluster)`. Its history
is a sequence of immutable `alert_events` rows, each with one of four
statuses:

| Event | Meaning |
|---|---|
| `firing` | The alert is active in Alertmanager and not silenced. |
| `suppressed` | The alert is active but covered by one or more silences (or inhibited). |
| `expired` | A silence covering the alert ended (expired or deleted) while the alert was still active — it is firing again. Recorded instead of a second plain `firing` row so the history shows *why* the alert became loud again. |
| `resolved` | The alert disappeared from the Alertmanager API — the underlying condition cleared. |

Valid transitions:

```
firing     → suppressed   silence created/activated
firing     → resolved     alert gone from the AM API
suppressed → firing       silence expired or deleted (recorded as an
                          "expired" event, then normal firing continues)
suppressed → resolved     condition cleared while still silenced —
                          straight to resolved, NO expired event
resolved   → firing       alert re-fires (new episode, see below)
```

Consecutive polls that see the same state record **nothing** — event
recording is idempotent. An alert firing for three days produces one
`firing` row, not 17,000.

## Episodes and `starts_at`

One **episode** is one continuous period in which the underlying condition
was true, from Alertmanager's point of view. Alertmanager identifies an
episode by the alert's `startsAt` timestamp: as long as the condition stays
true, `startsAt` does not change — even while the alert is silenced,
un-silenced, or silenced again.

This matters because a single episode can legitimately produce **multiple
`firing` rows**: `firing → suppressed → expired → firing` re-enters the
firing state without the condition ever having cleared. Consumers that count
"how often did this alert fire" (the heatmap, the card sparkline) therefore
group events by `starts_at`, not by counting `firing` rows — one episode is
counted exactly once, no matter how many silences came and went during it.

A genuine re-fire after a resolution gets a **new** `startsAt` from
Alertmanager and is therefore a new episode.

## The grace period — ghost-resolve prevention

**Rule: an alert that re-fires within `max(60s, 2 × JARVIS_POLL_INTERVAL)`
of being recorded as resolved is treated as if it never resolved.** The
`resolved` row is deleted and the previous event continues — no new episode,
no occurrence-count increment.

Why this exists: resolution is inferred from absence. A single missed or
flaky poll (network blip, slow Alertmanager response, Jarvis briefly
overloaded) makes an alert *look* gone for one cycle. Without the grace
period, every such blip would split one real episode into two — a phantom
`resolved` + re-fire pair polluting the history and inflating the occurrence
count.

Why it scales with the poll interval: the window must be able to absorb at
least one missed poll. A fixed 60s window can never do that once the poll
interval itself is 60s or more — the gap between two polls would always be
at least as wide as the window. `2 × interval` guarantees one full missed
cycle fits, with the 60s floor preserving the historical behavior for short
intervals.

The grace period deliberately does **not** apply to the
`suppressed → expired → firing` sequence — that is not a resolve at all, and
is handled by episode identity (`starts_at`) instead.

## Occurrence count

`occurrence_count` answers "how many separate episodes has this alert had?"
It increments **only** when a `firing` event follows a genuine `resolved`
event — never on the first firing (a brand-new alert has a count of 1 from
its fingerprint row, not from an increment), never on silence churn within
an episode, and never on a grace-period re-fire (the resolve is undone, so
the episode never ended).

## What happens on resolution

When an alert disappears from a poll snapshot, three things happen:

1. **A `resolved` event is recorded** immediately (inheriting the episode's
   `starts_at`, so the history stays internally consistent).
2. **The alert stays visible in the UI for 20 minutes**, greyed out in a
   "resolved buffer", so operators see recent resolutions without digging
   into the history view. After 20 minutes it moves to the resolved/history
   view only. If it re-fires within those 20 minutes it simply returns to
   the active list; the removal timer then only clears the (already empty)
   buffer entry and never touches the active list.
3. **Active claims are auto-released — but only after a delay** of
   `max(20min, 2 × grace period)`, and only if the alert is *still* resolved
   at that point. The delay exists so a grace-period re-fire can cancel the
   release: if the "resolution" turns out to be a polling artifact, the
   claim owner keeps the alert. A claim released this way carries the
   release reason `resolved`.

## Robustness guarantees

These are the failure scenarios the lifecycle recording is explicitly
hardened against. The common theme: **a gap in observation must never be
recorded as a resolution.**

### A cluster fetch fails (Alertmanager down or unreachable)

The recorder keeps each cluster's **last successfully fetched alert list**
and reuses it for any poll in which that cluster's fetch fails. Without
this, a failed fetch would contribute zero alerts to the diff, and every
alert of that cluster would appear to have resolved at once — phantom
`resolved` events, wrong occurrence counts, and claims released while the
alerts were in fact still firing. A transient Alertmanager outage therefore
freezes that cluster's recorded state instead of corrupting it. (The same
"snapshot only on success" rule applies to silences.)

For HA clusters this guard only engages when **all** members fail — a
single member outage is absorbed by the member merge.

### Jarvis restarts while alerts resolve

The poll diff lives only in memory, so after a restart Jarvis cannot tell
"this alert resolved while I was down" apart from "I have never seen this
alert". Left alone, an alert that resolved during the downtime would keep a
dangling `firing` row forever — and its *next* re-fire would be silently
swallowed by idempotency (`firing == firing`, nothing recorded).

**Startup reconciliation** repairs this: on each cluster's first successful
fetch after startup, Jarvis looks up all fingerprints whose latest recorded
event (within the last 7 days) is not `resolved`. Any of them missing from
that first fetch get a `resolved` event stamped with the startup time.

> **Deliberate approximation:** the recorded resolve time is the startup
> time, not the real moment the alert resolved during the downtime — that
> moment is unrecoverable. An approximately-timed resolve is more honest
> than a permanently stuck `firing` row.

Alerts still firing across the restart are simply re-observed; idempotency
ensures no duplicate rows.

### A poll is missed or delayed

Covered by the grace period (see above): one missed cycle always fits
inside the `max(60s, 2 × poll interval)` window, so a resolve+re-fire pair
caused purely by the miss is merged back into one episode.

### A silence expires mid-episode

Recorded as `expired` (not a duplicate `firing`), and episode counting by
`starts_at` ensures the heatmap and sparkline count the episode once. No
grace-period involvement — nothing resolved.

## What survives what

| Data | Jarvis restart | Alertmanager outage | Container update |
|---|---|---|---|
| Event history (all transitions) | ✓ (database) | ✓ (last-good snapshot freezes state) | ✓ |
| Occurrence counts | ✓ | ✓ | ✓ |
| Comments & claim history | ✓ | ✓ | ✓ |
| Active claims | ✓ | ✓ (no phantom auto-release) | ✓ |
| Resolved-buffer visibility (20 min, greyed out) | ✓ (re-seeded from the DB's recent resolves) | ✓ | ✓ |
| In-memory poll snapshot | rebuilt on first poll | frozen per failed cluster | rebuilt |

## Related configuration

| Setting | Effect on the lifecycle |
|---|---|
| `JARVIS_POLL_INTERVAL` (default `15s`) | Observation granularity: a state change is recorded at most one interval after it happened in Alertmanager. Also drives the grace period (`max(60s, 2 × interval)`) and, indirectly, the claim-release delay (`max(20min, 2 × grace period)`). |
| `JARVIS_DB_DSN` | Where the event log lives (SQLite file or PostgreSQL). The lifecycle semantics are identical on both. |

For the engineering-level reference (schema, store internals, invariants)
see [`.agents/architecture.md`](../.agents/architecture.md) and the Critical
Invariants in [`AGENTS.md`](../AGENTS.md).
