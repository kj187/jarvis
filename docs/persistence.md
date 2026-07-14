# Persistence & High Availability

This is the canonical guide to Jarvis's database backends, from a single
SQLite file to a horizontally-scaled PostgreSQL deployment on Kubernetes.
Every other doc that touches this topic ([README.md](../README.md),
[charts/jarvis/README.md](../charts/jarvis/README.md),
[docs/features.md](features.md), [docs/retention.md](retention.md),
[docs/alert-lifecycle.md](alert-lifecycle.md)) links here instead of
restating it.

**SQLite is the default and requires zero setup — use it for testing,
evaluation, and homelab-scale single-replica deployments. For production,
high availability, horizontal scaling, and long-term stability, use
PostgreSQL.**

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
  to feed.
- **TLS**: use `sslmode=require` (or `sslmode=verify-full` with a CA
  certificate) in production. `sslmode=disable` transmits the database
  password in plain text and must never be used outside a local, ephemeral
  test container.
- **Redaction**: the password in `JARVIS_DB_DSN` is redacted (`db.RedactDSN`)
  before it ever reaches a log line — the raw DSN is never logged.
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
follower retries the lock every 5 seconds; the leader heartbeats its own
connection on the same interval. Losing the connection (pod killed, network
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
browser either way. Alert-state broadcasts (`alerts_update`, the poll-time
`silences_update`) are **not** fanned out this way — every pod already
derives those from its own poll or consumed snapshot.

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
  [Kubernetes deployment](#kubernetes-deployment) below for the RBAC this
  needs.

### HA topology

![HA topology](assets/ha-topology.svg)

### Failover sequence

![HA failover sequence](assets/ha-failover.svg)

---

## Kubernetes deployment

The [Helm chart](../charts/jarvis/README.md) supports any `replicaCount` or
HPA configuration against PostgreSQL out of the box — no separate chart
mode, just point `database.dsn` at PostgreSQL and set `replicaCount` (or
enable `autoscaling`) to whatever the workload needs.

Relevant values (full reference: [charts/jarvis/README.md](../charts/jarvis/README.md)):

| Value | Default | Purpose |
|---|---|---|
| `replicaCount` | `1` | Pod count. `> 1` requires PostgreSQL. |
| `autoscaling.enabled` | `false` | HPA. Requires PostgreSQL, same as `replicaCount > 1`. |
| `podDisruptionBudget.enabled` | `false` | Keep at least `minAvailable` pods up during voluntary disruptions (node drains, upgrades). Meaningful only with `replicaCount`/HPA `> 1`. |
| `topologySpreadConstraints` | `[]` | Passed through verbatim — spread replicas across nodes/zones for real HA. |
| `leaderElection.podLabel.enabled` | `true` | The `jarvis.kj187.de/role=leader` pod label (see above). Renders a `Role`+`RoleBinding` (`pods`: `get`, `patch` only) and sets `automountServiceAccountToken: true` on the pod. Harmless to leave on with SQLite or a single replica — it just labels the one pod. |

### The SQLite guard

The chart fails fast rather than deploying a broken configuration:

```
Invalid configuration: persistence.enabled=true with SQLite requires replicaCount=1.
RWO volumes (e.g. EBS) support only one node mount and SQLite is single-writer.
Use PostgreSQL (database.dsn=postgres://...) for multi-replica deployments.
```

(and the equivalent for `autoscaling.enabled=true`). This is not a
limitation slated for removal — see [Why SQLite stays single-replica](#why-sqlite-stays-single-replica)
below.

### Example: CloudNativePG

[CloudNativePG](https://cloudnative-pg.io/) is a common, low-friction way to
run the PostgreSQL side of this on the same cluster:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: jarvis-postgres
spec:
  instances: 3
  storage:
    size: 5Gi
  bootstrap:
    initdb:
      database: jarvis
      owner: jarvis
```

CloudNativePG creates a Secret named `jarvis-postgres-app` with `username`,
`password`, `host`, `port`, `dbname` keys (and a ready-made `uri` connection
string). Wire it into the chart via `database.existingSecret` — the chart
reads `dsn` from that secret's key named by `database.existingSecretKey`,
so either project the CNPG secret's `uri` key under that name, or set
`database.existingSecretKey: uri` directly if your CNPG version already
names it that way:

```yaml
replicaCount: 3
database:
  existingSecret: jarvis-postgres-app
  existingSecretKey: uri
podDisruptionBudget:
  enabled: true
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app.kubernetes.io/name: jarvis
```

---

## Migration path: SQLite → PostgreSQL

There is no built-in data migration tool, and none is planned — the
recommended path is a **fresh start on PostgreSQL**: history does not
transfer. This is a deliberate, stated trade-off, not an oversight:

- Alert history is derived from Alertmanager's own state on every poll;
  within one grace-period window after cutover, the full current alert set
  reappears exactly as if Jarvis had just been (re)installed.
- Claims, comments, and silence templates are the only truly hand-entered
  data, and in practice these don't accumulate to a volume worth building
  an export/import tool for.
- Keeping the migration path deliberately absent avoids maintaining a
  second, rarely-exercised code path (see
  [docs/scope.md](scope.md) — this mirrors the project's general bias
  against speculative tooling).

Practically: stop Jarvis, set `JARVIS_DB_DSN` to the new PostgreSQL
connection string, start it again. Migrations create the schema on first
connection; Jarvis starts recording fresh history from that point on.

---

## Why SQLite stays single-replica

Every path to SQLite multi-replica was evaluated and rejected:

| Approach | Why not |
|---|---|
| Litestream | Streaming backup/restore only — no multi-writer, no live read replicas. |
| LiteFS | Leader + read replicas via FUSE; needs write forwarding and FUSE privileges in containers — operationally worse than just running PostgreSQL. |
| dqlite | Requires CGO — breaks the pure-Go, no-CGO build (`CGO_ENABLED=0`, distroless final image). |
| rqlite | A separate Raft-replicated server process — anyone able to operate that can operate PostgreSQL directly. |
| Embedded replication (build Raft into Jarvis) | Massive effort building consensus/snapshotting/membership into an Alertmanager UI — far outside [docs/scope.md](scope.md). |

This is the same shape most comparable projects settle on — Grafana,
Gitea, Authentik, Miniflux all treat SQLite as the zero-config/small-setup
mode and PostgreSQL/MySQL as the HA/production mode. It is an established
pattern, not a weakness signal.
