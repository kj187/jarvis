# PostgreSQL & HA

This is the canonical guide to running Jarvis against PostgreSQL and scaling
it to several replicas. Every other doc that touches this topic
([README.md](../README.md), [charts/jarvis/README.md](../charts/jarvis/README.md),
[docs/features.md](features.md), [docs/retention.md](retention.md),
[docs/alert-lifecycle.md](alert-lifecycle.md)) links here instead of
restating it.

**SQLite is the default and requires zero setup — use it for testing,
evaluation, and homelab-scale single-replica deployments. For production,
high availability, horizontal scaling, and long-term stability, use
PostgreSQL.** See [Why SQLite stays single-replica](sqlite-limits.md) for the
reasoning.

---

## Configuration

One environment variable selects both the dialect and the connection:

```env
JARVIS_DB_DSN=/data/jarvis.db
# or
JARVIS_DB_DSN=postgres://jarvis:secret@postgres:5432/jarvis?sslmode=require
```

- **Dialect auto-detection**: a `postgres://` or `postgresql://` prefix
  selects PostgreSQL; anything else is treated as a SQLite file path. No
  separate "which database" setting exists.
- **Migrations** run automatically on every startup and are idempotent —
  safe to restart, safe to upgrade in place. Both dialects are kept in
  schema parity (`internal/db/migrate_sqlite.go` /
  `migrate_postgres.go`); PostgreSQL additionally has one dialect-only
  table, `poll_snapshots` (see
  [Leader-only polling & snapshot distribution](#leader-only-polling--snapshot-distribution)
  below) — SQLite never creates or reads it, since it never has followers
  to feed. On PostgreSQL, every pod runs migrations on startup — before
  leader election even begins — so the whole statement list is wrapped in
  a session-level advisory lock (`pg_advisory_lock`, class ID `0x4A525653`
  same as leader election, lock ID `2` so it can never collide with the
  leader-election lock's ID `1`) held on a dedicated connection. Without
  it, two pods racing `CREATE TABLE IF NOT EXISTS` during a rolling
  deploy can both lose the race to PostgreSQL's own catalog uniqueness
  check and crash.
- **TLS**: use `sslmode=require` (or `sslmode=verify-full` with a CA
  certificate) in production. `sslmode=disable` transmits the database
  password in plain text and must never be used outside a local, ephemeral
  test container.
- **Redaction**: the password in `JARVIS_DB_DSN` is redacted (`db.RedactDSN`)
  before it ever reaches a log line — the raw DSN is never logged.
- **Connection-pool cap**: `JARVIS_DB_MAX_OPEN_CONNS` (default `10`) caps
  the PostgreSQL pool per pod; idle connections are kept up to the same cap
  so request bursts reuse connections instead of churning them
  (`ConnMaxLifetime=30m`, `ConnMaxIdleTime=5m`). Each pod additionally holds
  one dedicated connection for leader election and one for the
  LISTEN/NOTIFY WS fanout. Size it so
  `replicas × (JARVIS_DB_MAX_OPEN_CONNS + 2)` stays well below the server's
  `max_connections` minus its reserved slots — an unbounded pool has
  exhausted the connection slots of a shared RDS instance in production
  (`FATAL: remaining connection slots are reserved …`, SQLSTATE 53300).
  Ignored for SQLite, which is always single-connection.
- **Local PostgreSQL for testing**: `make up-postgres` starts a disposable
  container on port 5432 (`jarvis`/`jarvis`/`jarvis`); point
  `JARVIS_DB_DSN=postgres://jarvis:jarvis@localhost:5432/jarvis?sslmode=disable`
  at it. `sslmode=disable` is intentional there — it's a local, ephemeral,
  no-TLS container, never a production target.

---

## High availability & multi-replica (PostgreSQL only)

With `replicaCount`/HPA `> 1` against PostgreSQL, every pod runs the exact
same binary — there is no separate "primary" deployment mode. Coordination
happens entirely through PostgreSQL; no additional infrastructure (no Redis,
no etcd, no client-go/Kubernetes Lease objects) is required.

### Leader election

Exactly one pod is **leader** at any time, decided by a PostgreSQL
session-level advisory lock (`pg_try_advisory_lock`) held on a dedicated
connection — not the shared pool, since pool connections get recycled. A
pod attempts the lock immediately once its connection is up (so a fresh
pod with no incumbent leads within one round-trip), then a follower retries
every 5 seconds; the leader heartbeats its own connection on the same
interval. Losing the connection (pod killed, network
partition, crash) releases the lock automatically — there is no TTL or
lease-renewal bookkeeping, PostgreSQL's own session cleanup is the failure
detector. The elector's connection uses aggressive TCP keepalives (idle 5s /
interval 3s / count 3) so even a hard node failure — no graceful FIN — is
detected and the lock released within single-digit seconds, not the
OS-default keepalive timeout (which can take minutes).

SQLite deployments skip all of this: single replica by design, this pod is
always leader.

### Leader-only polling & snapshot distribution

Only the leader polls Alertmanager — Alertmanager load does not scale with
`replicaCount`. The leader also owns every history write (event lifecycle,
occurrence counts, claim releases, retention sweeps, external-silence
event recording).

Followers never poll Alertmanager. Instead, after every poll the leader
gzip's a compact per-cluster JSON snapshot (alerts, silences, member
up/down state) into the `poll_snapshots` table and
`pg_notify('jarvis_snapshot', clusterName)`. Followers `LISTEN` on that
channel (plus a periodic full resync as a fallback, in case a notification
is ever missed) and merge the changed cluster's snapshot into their own
in-memory stores — so **every** pod still serves reads, the REST API, and
WebSocket pushes to its own connected browsers, from a snapshot that is
at most one poll interval old, regardless of which pod happens to be
leader right now.

When a follower rebuilds its alert store from a snapshot it also re-reads
the active claims from the shared database and re-attaches them to the
merged alerts (the same batched read the leader does each poll). The
snapshot only carries the claims that existed as of the leader's last
poll, so without this a claim made against any pod would flash in the UI
and then disappear until the leader's next poll — and a claim released
between leader polls would keep showing on followers just as long.

A user-triggered mutation (creating a silence, for instance) still needs an
immediate poll to reconcile against Alertmanager quickly. A follower can't
poll itself, so it forwards the request via `pg_notify('jarvis_trigger',
'')`; the leader `LISTEN`s on that channel and treats it exactly like a
local trigger.

### Cross-pod WebSocket mutation fanout

Comments, claims, and silence mutations are broadcast over WebSocket to
whichever pod's browser connections are watching. A mutation handled by one
pod publishes the encoded WS message via `pg_notify('jarvis_ws', ...)`
(origin-tagged so a pod never re-delivers its own publish to itself); every
other pod is `LISTEN`ing and re-broadcasts to its own clients. PostgreSQL's
NOTIFY payload limit (~8000 bytes) is handled gracefully: an oversized
message (a long comment body, for instance) is replaced by a small
reference; the receiving pod refetches the authoritative row from the
shared database and reconstructs the exact broadcast — transparent to the
browser either way. For a claim set or released, the receiving pod also
patches its own in-memory alert store (not just the WebSocket broadcast) —
otherwise a browser's REST refetch that load-balances onto that pod before
its next snapshot rebuild would briefly show the claim disappearing again.
Alert-state broadcasts (`alerts_update`, the poll-time `silences_update`)
are **not** fanned out this way — every pod already derives those from its
own poll or consumed snapshot.

### User settings

`user_settings` (one opaque JSON blob per user, `internal/settings`) is
**not** part of any of the above machinery. Every `GET /api/v1/settings`
reads the row straight from the database — no in-memory cache, so nothing
needs invalidating across pods, no leader gating, and no WebSocket fanout,
since there is no history side effect to serialize (Critical Invariant #15
does not apply here). The trade-off: two browser tabs of the same user on
different pods only converge on the next page load of either tab, not
instantly — accepted as out of scope for a personal-preferences row that
changes rarely.

### Failover

Kill, evict, or drain the leader pod: PostgreSQL releases its session lock
(instantly on a graceful shutdown, within seconds of TCP-keepalive
detection on a hard failure), a follower acquires it, and immediately:

1. Starts polling Alertmanager.
2. Runs a one-time startup reconciliation — resolves any alert that
   actually went away while this pod was a follower (it couldn't record
   that itself, since only the leader writes history).
3. Begins persisting/notifying snapshots for the followers now behind it.

Typical takeover is well under 10 seconds (5s heartbeat + 5s retry
interval); a hard node failure is bounded by the elector connection's TCP
keepalive (worst case ~15-20s). The existing grace-period guarantee (a
resolve immediately followed by a re-fire within the poll-scaled grace
window reopens the same episode rather than starting a new one) holds
across a leadership change exactly as it does on a single replica — the
new leader's poll sees the same Alertmanager state a continuously-running
single pod would have.

### Observability

- `jarvis_leader` (gauge, 0/1) — whether this pod currently holds
  leadership. Always `1` on SQLite.
- `jarvis_snapshot_stale` (gauge, 0/1) — whether a follower's consumed
  snapshot is older than 3× `JARVIS_POLL_INTERVAL` (a sign that
  notifications and the periodic resync have both been missed for a
  while — check the leader's health). Always `0` while leader or on
  SQLite.
- Leader-transition log lines and the `leader` field in the `/api/v1/status`
  response.
- **Pod label**: on Kubernetes, the current leader's pod is labeled
  `jarvis.kj187.de/role=leader` and the label moves automatically on
  failover:
  ```bash
  kubectl get pods -L jarvis.kj187.de/role
  ```
  This is informational only — every pod serves all traffic regardless of
  leadership, there is no leader-only routing. See
  [Deploy on Kubernetes](deploy-kubernetes.md) for the RBAC this needs.

### HA topology

![HA topology](assets/ha-topology.svg)

### Failover sequence

![HA failover sequence](assets/ha-failover.svg)

---

## Where to go next

- [Deploy on Kubernetes](deploy-kubernetes.md) — chart values, the SQLite guard, a CloudNativePG example
- [Migrate from SQLite](migrate-postgres.md)
- [Why SQLite stays single-replica](sqlite-limits.md)
