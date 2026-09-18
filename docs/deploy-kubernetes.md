# Install on Kubernetes

The Helm chart is published to GHCR as an OCI artifact next to the image, so
no separate Helm repository has to be added.

Before installing a chart or image in production, [verify its signature and
build provenance](verify-release.md). Verification binds the artifact digest
to Jarvis's GitHub Actions release workflow instead of trusting a mutable tag
alone.

```bash
helm install jarvis oci://ghcr.io/kj187/charts/jarvis \
  --version 2.0.0 \
  --set clusters[0].name=production \
  --set clusters[0].alertmanagerUrl=http://alertmanager:9093
```

**Pick the database before you scale.** SQLite is single-replica by design.
Any `replicaCount > 1`, an HPA, or a PodDisruptionBudget needs PostgreSQL —
every pod would otherwise poll Alertmanager on its own and keep a diverging
history. The chart fails the render rather than deploying that — see
[Why SQLite stays single-replica](sqlite-limits.md).

```bash
helm install jarvis oci://ghcr.io/kj187/charts/jarvis \
  --version 2.0.0 \
  --set replicaCount=3 \
  --set database.dsn='postgres://jarvis:secret@postgres:5432/jarvis?sslmode=require' \
  --set clusters[0].name=production \
  --set clusters[0].alertmanagerUrl=http://alertmanager:9093
```

Leader election, snapshot distribution and failover behaviour are described in
[PostgreSQL & HA](postgres-ha.md).

Jarvis keeps recorded history, claims, comments, and silence events forever by
default. Configure [Data retention](retention.md) deliberately for long-running
clusters so the database does not grow without a bound.

The full values reference and worked examples — SQLite with a PVC,
PostgreSQL, multi-cluster, ingress-nginx with WebSocket support, external
secrets — live in the [Helm values reference](../charts/jarvis/README.md).

---

The chart supports any `replicaCount` or HPA configuration against
PostgreSQL out of the box — no separate chart mode, just point
`database.dsn` at PostgreSQL and set `replicaCount` (or enable
`autoscaling`) to whatever the workload needs.

Relevant values (full reference: [Helm values reference](../charts/jarvis/README.md)):

| Value | Default | Purpose |
|---|---|---|
| `replicaCount` | `1` | Pod count. `> 1` requires PostgreSQL. |
| `autoscaling.enabled` | `false` | HPA. Requires PostgreSQL, same as `replicaCount > 1`. |
| `podDisruptionBudget.enabled` | `false` | Keep at least `minAvailable` pods up during voluntary disruptions (node drains, upgrades). Meaningful only with `replicaCount`/HPA `> 1`. |
| `topologySpreadConstraints` | `[]` | Passed through verbatim — spread replicas across nodes/zones for real HA. |
| `leaderElection.podLabel.enabled` | `true` | The `jarvis.kj187.de/role=leader` pod label. Renders a `Role`+`RoleBinding` (`pods`: `get`, `patch` only) and sets `automountServiceAccountToken: true` on the pod. Harmless to leave on with SQLite or a single replica — it just labels the one pod. |

## Example: CloudNativePG

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

## Health checks

The chart's liveness and readiness probes both call `GET /health`
(`charts/jarvis/templates/deployment.yaml`) — a plain `{"status": "ok"}`
handler with no dependency checks, so a `200` only means the process is up
and serving HTTP. Like `/metrics` ([Monitoring and metrics](metrics.md)), it is
intentionally public and bypasses `JARVIS_AUTH_MODE=full_protect`, so probes
never need credentials.

For HA debugging beyond "is the process up" — which pod currently holds
leadership — see `GET /api/v1/status` in
[PostgreSQL & HA](postgres-ha.md#observability).

## Where to go next

- [PostgreSQL & HA](postgres-ha.md) — leader election, snapshot distribution, failover
- [Migrate from SQLite](migrate-postgres.md)
- [Behind a proxy](reverse-proxy.md) — ingress and WebSocket passthrough
- [Data retention](retention.md) — control long-term database growth
- [Verify release artifacts](verify-release.md) — check the chart and image before rollout
- [Helm values reference](../charts/jarvis/README.md)
