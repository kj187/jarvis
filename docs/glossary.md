# Glossary

Terms used throughout the documentation without re-explaining them each
time. Each entry links to the page that covers it in full.

## Claim

A user-visible marker that someone is actively handling an alert. Stored in
Jarvis's own database per `(fingerprint, cluster)`, so it survives page
reloads and restarts, and is released automatically if the alert stays
resolved past a delay comfortably longer than the grace period. See
[Claim ownership](features.md#alert-detail-panel).

## Episode

One continuous period during which an alert's underlying condition holds,
identified by the alert's `startsAt` timestamp rather than by counting
individual `firing` rows — a single episode can legitimately produce
multiple `firing` rows (a poll catching the same condition again, a silence
expiring mid-episode). See
[Episodes and `starts_at`](alert-lifecycle.md#episodes-and-starts_at).

## Fingerprint

Alertmanager's stable identifier for one alert instance, derived from its
label set. Jarvis keys history, comments, and claims on `(fingerprint,
cluster)`, since the same fingerprint can legitimately exist in more than
one configured cluster. See [Architecture](architecture.md).

## Grace period

The window (`max(60s, 2 × JARVIS_POLL_INTERVAL)`) in which an alert seen
firing again shortly after being recorded as resolved is treated as the same
episode continuing, rather than a new one — this is what stops a single
missed poll from splitting one real incident into a phantom `resolved` /
`firing` pair. See
[The grace period — ghost-resolve prevention](alert-lifecycle.md#the-grace-period--ghost-resolve-prevention).

## Leader

The one Jarvis pod that owns Alertmanager polling and history side effects in
a multi-replica PostgreSQL deployment. PostgreSQL advisory locking elects it;
followers continue serving reads and WebSockets from distributed snapshots.
SQLite installations always have one replica, which is therefore always the
leader. See [PostgreSQL & HA](postgres-ha.md#high-availability--multi-replica-postgresql-only).

## Recorder

The backend component that polls every configured cluster on a fixed
schedule (`JARVIS_POLL_INTERVAL`), diffs each poll against the previous one,
and writes every resulting state change to the database. On a single
replica it is always active; with PostgreSQL and more than one replica,
only the current leader runs it. See [Alert lifecycle](alert-lifecycle.md)
and [PostgreSQL & HA](postgres-ha.md).

## Snapshot

The result of one poll cycle for one cluster — its current alerts, silences,
and per-member up/down state — held in memory so reads never call
Alertmanager directly. In a multi-replica PostgreSQL deployment the leader
additionally persists each snapshot to the `poll_snapshots` table so
follower pods can merge it into their own in-memory store instead of
polling themselves. See
[Leader-only polling & snapshot distribution](postgres-ha.md#leader-only-polling--snapshot-distribution).

## Sweep

One scheduled data-retention pass. The sweeper deletes eligible alert events,
released claims, silence audit events, and—only when explicitly configured—old
comments whose retention cutoff has passed. A sweep never deletes the head of
an open alert episode or an active claim. In PostgreSQL HA deployments it runs
only on the leader. See [Data retention](retention.md#how-the-sweep-works).

## Suppressed

An alert that is still firing but is currently covered by an active
Alertmanager silence. Jarvis keeps it separate from active alerts while still
recording the same underlying episode. See
[Alert states](alert-lifecycle.md#states-and-events).
