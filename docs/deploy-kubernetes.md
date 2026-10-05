# Install on Kubernetes

The Helm chart is published to GHCR as an OCI artifact next to the image, so
no separate Helm repository has to be added.

Before installing a chart or image in production, [verify its signature and
build provenance](verify-release.md). Verification binds the artifact digest
to Jarvis's GitHub Actions release workflow instead of trusting a mutable tag
alone.

```bash
helm install jarvis oci://ghcr.io/kj187/charts/jarvis \
  --version 2.1.0 \
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
  --version 2.1.0 \
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

The chart's probes use two endpoints (`charts/jarvis/templates/deployment.yaml`):

| Probe | Path | Answers |
|---|---|---|
| liveness | `GET /health/live` | `200` while the process serves HTTP. No dependency checks, so a database outage never restarts the pod. |
| readiness | `GET /health/ready` | `200` while the database answers a ping (2 s timeout, result cached for 5 s), otherwise `503`. A pod that loses its database leaves the Service endpoints and returns when the database does. |

An unreachable Alertmanager deliberately does **not** turn readiness red:
every pod would drop out of the Service at once and take the UI down with it.
That state shows up per cluster in the UI (stale banner) and in
`jarvis_snapshot_stale` / `jarvis_alertmanager_up` instead. `GET /health` stays as
a plain `{"status": "ok"}` for existing probes and compose healthchecks.

All three endpoints are intentionally public like `/metrics` ([Monitoring and
metrics](metrics.md)) and bypass `JARVIS_AUTH_MODE=full_protect`, so probes
never need credentials. They return no error details.

**Upgrading the chart:** the probe paths exist from the Jarvis version that
ships with this chart. Keep `image.tag` at the chart default, or use a Jarvis
version that has `/health/live` and `/health/ready`.

For HA debugging beyond "is the process up" — which pod currently holds
leadership — see `GET /api/v1/status` in
[PostgreSQL & HA](postgres-ha.md#observability).

## Network policy

`networkPolicy.enabled: true` renders one `NetworkPolicy` that selects every
pod of the release and restricts both directions. It is off by default, so an
existing release renders unchanged, and it needs a CNI that enforces
NetworkPolicy (Calico, Cilium and most managed clusters do).

- **Ingress** allows only TCP 8080. `networkPolicy.ingress.from` limits the
  sources (the ingress controller, and Prometheus if it scrapes `/metrics`);
  empty allows every source.
- **Egress** allows DNS only (`networkPolicy.egress.allowDns`) plus the rules
  you list in `networkPolicy.egress.rules`. Jarvis connects to Alertmanager (and
  Prometheus), the database, the OIDC issuer, and, with
  `leaderElection.podLabel.enabled`, the Kubernetes API, so each of those needs a
  rule. Without one the pod cannot reach it.

```yaml
networkPolicy:
  enabled: true
  ingress:
    from:
      - namespaceSelector:
          matchLabels:
            kubernetes.io/metadata.name: ingress-nginx
  egress:
    rules:
      - to:
          - namespaceSelector:
              matchLabels:
                kubernetes.io/metadata.name: monitoring
        ports:
          - port: 9093
            protocol: TCP
      - to:
          - namespaceSelector:
              matchLabels:
                kubernetes.io/metadata.name: databases
        ports:
          - port: 5432
            protocol: TCP
```

The Kubernetes API has no stable selector; allow its address from
`kubectl get endpoints kubernetes` on port 443 (or 6443), or turn the leader pod
label off. Check a new policy by watching the clusters in the UI: an unreachable
Alertmanager shows as a stale banner within a few poll intervals.

## Pin the image by digest

`image.digest` pins the pod to the exact image you verified, so a re-pushed tag
cannot change what runs. [Verify the signature](verify-release.md) first, then
set the digest of the tag you deploy:

```yaml
image:
  tag: 2.0.0
  digest: sha256:<64 hex characters>
```

The reference becomes `ghcr.io/kj187/jarvis:2.0.0@sha256:...`. When you bump
`image.tag`, update the digest in the same change; with the two out of step the
digest wins and the old image keeps running.

## Configuration changes roll the pods

Jarvis reads its environment once, at startup. The chart therefore puts a
checksum of the rendered ConfigMap (`checksum/config`) and of the Secret it
creates (`checksum/secret`) into the pod template: a `helm upgrade` that changes
a value such as `auth.mode`, `config.pollInterval` or a chart-managed secret
rolls the Deployment by itself, and re-running the same chart version with the
same values leaves the pods alone. The two keys belong to the chart; a
`podAnnotations` entry with the same name is ignored.

Two cases are outside what Helm can see. A Secret you supply through
`database.existingSecret`, `auth.existingSecret` or
`clusters[].auth.existingSecret` is not rendered by the chart, and an edit made
directly on the cluster (`kubectl edit`) does not go through Helm at all. After
either, restart the Deployment yourself (`kubectl rollout restart
deployment/<name>`, the name `kubectl get deployments` shows) or let a controller
such as [Stakater Reloader](https://github.com/stakater/Reloader) do it.

The checksum of the chart-created Secret is visible to anyone who may read the
Deployment, and it is a plain SHA-256 of the rendered manifest. Use strong,
random values for the database password and any client secret you give the chart,
or keep them in an `existingSecret`.

## Where to go next

- [PostgreSQL & HA](postgres-ha.md) — leader election, snapshot distribution, failover
- [Migrate from SQLite](migrate-postgres.md)
- [Behind a proxy](reverse-proxy.md) — ingress and WebSocket passthrough
- [Data retention](retention.md) — control long-term database growth
- [Verify release artifacts](verify-release.md) — check the chart and image before rollout
- [Helm values reference](../charts/jarvis/README.md)
