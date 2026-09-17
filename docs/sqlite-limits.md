# Why SQLite Stays Single-Replica

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

## The guard

The chart fails fast rather than deploying a broken configuration:

```
Invalid configuration: persistence.enabled=true with SQLite requires replicaCount=1.
RWO volumes (e.g. EBS) support only one node mount and SQLite is single-writer.
Use PostgreSQL (database.dsn=postgres://...) for multi-replica deployments.
```

(and the equivalent for `autoscaling.enabled=true`). This is not a
limitation slated for removal — every pod would otherwise poll Alertmanager
on its own and keep a diverging history, exactly the failure mode the table
above rejects every SQLite-replication workaround to avoid.

See [Deploy on Kubernetes](deploy-kubernetes.md) for the surrounding chart
values, and [PostgreSQL & HA](postgres-ha.md) for what multi-replica looks
like once you switch.
