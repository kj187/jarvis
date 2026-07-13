# Data Retention

Jarvis stores every alert lifecycle event, comment, claim, and silence
action forever by default. On a long-running install this can grow the
database indefinitely. Data retention gives an admin an **optional**,
env-var-only way to bound that growth with a background sweep — there is no
UI or API for it, consistent with the rest of Jarvis's server configuration.

**Disabled by default.** With no `JARVIS_RETENTION_*` variable set, nothing
is ever deleted — an upgrade never silently removes data.

## What gets swept

| Table | Deleted when | Kept regardless of age |
|---|---|---|
| `alert_events` | Superseded by a newer event for the same alert+cluster, or the episode is already closed (`resolved`/`expired`), and older than the cutoff | The most recent event of a still-`firing`/`suppressed` alert — its open episode head, however old |
| `alert_claims` | Released (not active) and older than the cutoff (by release time) | Any currently active claim |
| `alert_comments` | Older than the cutoff — **only if you explicitly opt in** | Everything, by default |
| `silence_events` | Older than the cutoff (pure audit log, by record time) | Nothing special — audit log has no exceptions |
| `alert_fingerprints` | No events, claims, or comments reference it anymore, and it hasn't been seen recently | A fingerprint with a surviving comment, claim, or event of any age |

**Comments are the deliberate exception.** They are never deleted by the
global retention setting — only an explicit
`JARVIS_RETENTION_COMMENTS_DAYS` enables it. The reasoning: if an alert goes
quiet for months and then fires again with the same fingerprint and
cluster, any comments left on it (root-cause notes, links to a ticket,
context for the next responder) should still be there. Deleting comments
by default would erase exactly the context that makes a recurring alert
faster to triage the second time.

## Configuration

All values are in days unless noted; set in `.env` or the container's
environment (see `.env.example`).

| Variable | Default | Meaning |
|---|---|---|
| `JARVIS_RETENTION_DAYS` | `0` (disabled) | Global default retention window |
| `JARVIS_RETENTION_EVENTS_DAYS` | inherits global | Override for `alert_events` |
| `JARVIS_RETENTION_CLAIMS_DAYS` | inherits global | Override for released `alert_claims` |
| `JARVIS_RETENTION_SILENCE_EVENTS_DAYS` | inherits global | Override for `silence_events` |
| `JARVIS_RETENTION_COMMENTS_DAYS` | `0` (kept forever) | Comments — **never** inherits the global value; only an explicit value here enables deletion |
| `JARVIS_RETENTION_SWEEP_INTERVAL` | `12h` | How often the background sweep runs |

An override of `0`/unset for events, claims, or silence events falls back to
the global `JARVIS_RETENTION_DAYS`. An override greater than `0` applies
even when the global is `0`, so you can enable retention for a single
domain without touching the others (e.g. only trim the silence audit log).

Negative values are rejected at startup.

### Examples

```bash
# Recommended production baseline: keep a year of history everywhere
# except comments, which stay forever.
JARVIS_RETENTION_DAYS=365

# Same, but also purge comments after 6 months.
JARVIS_RETENTION_DAYS=365
JARVIS_RETENTION_COMMENTS_DAYS=180

# Trim only the silence audit log, leave everything else untouched.
JARVIS_RETENTION_SILENCE_EVENTS_DAYS=90
```

## How the sweep works

A single background loop (`internal/retention.Sweeper`) starts 1 minute
after Jarvis boots (so it doesn't compete with startup), then runs every
`JARVIS_RETENTION_SWEEP_INTERVAL`. Each domain is deleted in batches of 500
rows with a short pause in between, so a large sweep never holds the
SQLite single-writer lock for one long transaction.

Order matters, because of foreign keys and the fingerprint-orphan check:

1. Comments (if explicitly enabled)
2. Released claims
3. Silence events
4. Detach any surviving comment/claim from an event about to be deleted
   (their `event_id` reference is cleared, not the comment/claim itself)
5. Events
6. Orphaned fingerprints — using the **widest** of all the cutoffs above, so
   a fingerprint only disappears once nothing anywhere still references it

## Known effect on per-cluster statistics

An alert's **global** occurrence count survives event deletion — it lives
on the fingerprint row, not on individual events. Its **per-cluster**
stats (occurrence count, first/last seen, the firing heatmap) are derived
directly from `alert_events`, so after a sweep they only reflect the
retention window, not the alert's entire history. This is the accepted
trade-off of retention: those views show fewer old entries, by design.

If a fingerprint's events are fully swept but it survives only because a
comment is still attached, and the alert re-fires later, Jarvis has no
prior event to compare against — the re-fire is treated like a first
firing and the occurrence count is **not** incremented (it also isn't
reset; the existing count is simply left alone).

## Observability

Every sweep logs a summary line (rows deleted per table, duration) and
updates three Prometheus metrics — see
[docs/metrics.md](metrics.md#event-counters):
`jarvis_retention_sweeps_total`, `jarvis_retention_deleted_rows_total{table=...}`,
`jarvis_retention_sweep_duration_seconds`.

## Non-goals (v1)

- No `VACUUM`/file compaction — SQLite reuses freed pages internally, which
  is enough to bound growth; the file itself won't shrink.
- No admin UI or API to trigger a sweep manually or change retention at
  runtime — env-var configuration only.
- No per-cluster or per-alertname retention rules.
- No archiving/export before deletion.
