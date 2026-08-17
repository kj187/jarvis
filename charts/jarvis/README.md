# Jarvis Helm Chart

Web frontend for Prometheus Alertmanager with persistent alert history, claims, comments, and silence management.

> Database backends, multi-replica HA (leader election, snapshot distribution, failover), and Kubernetes deployment guidance (incl. a CloudNativePG example) are covered in the canonical guide: **[docs/persistence.md](../../docs/persistence.md)**. This README covers only the chart's values and install/upgrade mechanics.

## Install

```bash
helm install jarvis oci://ghcr.io/kj187/charts/jarvis \
  --version <version> \
  --set clusters[0].name=production \
  --set clusters[0].alertmanagerUrl=http://alertmanager:9093
```

Or with a values file:

```bash
helm install jarvis oci://ghcr.io/kj187/charts/jarvis --version <version> -f values.yaml
```

## Upgrade

```bash
helm upgrade jarvis oci://ghcr.io/kj187/charts/jarvis --version <version> -f values.yaml
```

## Uninstall

```bash
helm uninstall jarvis
```

## Versioning

The chart version is **decoupled** from the app version. `appVersion` in
`Chart.yaml` pins the default image tag; the chart `version` is bumped
whenever the chart itself changes (including appVersion-only bumps). The chart
is published automatically by `.github/workflows/chart-release.yml` when a
change under `charts/` lands on `main` — published versions are immutable.

## Verify the chart signature

Charts are signed keylessly with [cosign](https://github.com/sigstore/cosign)
(GitHub OIDC):

```bash
cosign verify ghcr.io/kj187/charts/jarvis:<version> \
  --certificate-identity-regexp="https://github.com/kj187/jarvis/.*" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com"
```

## Testing

The chart ships unit tests via [helm-unittest](https://github.com/helm-unittest/helm-unittest). No Kubernetes cluster is needed.

```bash
# Install plugin once
helm plugin install https://github.com/helm-unittest/helm-unittest --version v0.8.2

# Run all chart tests
helm unittest charts/jarvis/

# Also available via Makefile
make helm-lint    # static validation
make helm-test    # unit tests
```

Tests cover four suites (`deployment`, `configmap`, `secret`, `ingress`) and run automatically in the pre-commit hook (when `charts/` files are staged) and in CI.

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `replicaCount` | int | `1` | Number of replicas (for `>1`, use PostgreSQL backend) |
| `image.repository` | string | `ghcr.io/kj187/jarvis` | Container image repository |
| `image.tag` | string | `""` | Image tag (defaults to chart appVersion) |
| `image.pullPolicy` | string | `IfNotPresent` | Image pull policy |
| `imagePullSecrets` | list | `[]` | Image pull secrets |
| `nameOverride` | string | `""` | Override chart name |
| `fullnameOverride` | string | `""` | Override fully qualified app name |
| `serviceAccount.create` | bool | `true` | Create a ServiceAccount |
| `serviceAccount.annotations` | object | `{}` | ServiceAccount annotations |
| `serviceAccount.name` | string | `""` | ServiceAccount name (auto-generated when empty) |
| `leaderElection.podLabel.enabled` | bool | `true` | Label the current leader pod `jarvis.kj187.de/role=leader` (informational only — every pod serves all traffic). Renders a `Role`+`RoleBinding` (`pods`: `get`, `patch`) and sets `automountServiceAccountToken: true` on the pod; meaningful only with PostgreSQL and `replicaCount`/HPA `> 1`, harmless to leave on otherwise |
| `podAnnotations` | object | `{}` | Pod annotations |
| `podSecurityContext` | object | `{runAsNonRoot: true, runAsUser: 65532, ...}` | Pod-level security context |
| `securityContext` | object | `{allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, ...}` | Container-level security context |
| `service.type` | string | `ClusterIP` | Kubernetes Service type |
| `service.port` | int | `80` | Service port |
| `metrics.serviceMonitor.enabled` | bool | `false` | Create a Prometheus Operator `ServiceMonitor` for `/metrics` (requires the `monitoring.coreos.com/v1` CRDs) |
| `metrics.serviceMonitor.interval` | string | `30s` | Scrape interval |
| `metrics.serviceMonitor.scrapeTimeout` | string | `10s` | Scrape timeout |
| `metrics.serviceMonitor.labels` | object | `{}` | Extra labels on the `ServiceMonitor` (e.g. to match a `kube-prometheus-stack` release selector) |
| `metrics.serviceMonitor.annotations` | object | `{}` | Extra annotations on the `ServiceMonitor` |
| `metrics.serviceMonitor.relabelings` | list | `[]` | Prometheus Operator `Endpoint.relabelings` (target relabeling before scrape) |
| `metrics.serviceMonitor.metricRelabelings` | list | `[]` | Prometheus Operator `Endpoint.metricRelabelings` (metric relabeling after scrape) |
| `metrics.serviceMonitor.honorLabels` | bool | `false` | `Endpoint.honorLabels` — keep `false` unless you specifically want Jarvis's own metric labels (e.g. `cluster`) to win over scrape-time labels on a collision |
| `metrics.podAnnotations` | bool | `false` | Add `prometheus.io/scrape`, `prometheus.io/port`, `prometheus.io/path` pod annotations instead (annotation-based scraping) |
| `ingress.enabled` | bool | `false` | Enable Ingress |
| `ingress.className` | string | `""` | Ingress class name |
| `ingress.annotations` | object | `{}` | Ingress annotations |
| `ingress.hosts` | list | `[{host: jarvis.example.com, paths: [{path: /, pathType: Prefix}]}]` | Ingress hosts |
| `ingress.tls` | list | `[]` | Ingress TLS configuration |
| `config.logLevel` | string | `info` | Log level (`info` or `debug`) |
| `config.pollInterval` | string | `15s` | Alertmanager poll interval |
| `config.runbookBaseURL` | string | `""` | Base URL prepended to runbook label values |
| `config.allowedOrigins` | string | `""` | Comma-separated allowed CORS/WebSocket origins |
| `clusters` | list | see below | Alertmanager cluster list (at least one required) |
| `clusters[].name` | string | `default` | Display name for the cluster |
| `clusters[].alertmanagerUrl` | string | `http://alertmanager:9093` | Internal Alertmanager URL |
| `clusters[].prometheusUrl` | string | `""` | Optional Prometheus URL |
| `clusters[].hostAlias` | string | `""` | Optional browser-visible URL override |
| `database.dsn` | string | `/data/jarvis.db` | Database DSN (SQLite path or `postgres://` URL; PostgreSQL recommended for production) |
| `database.existingSecret` | string | `""` | Use an existing Secret for the DSN instead |
| `database.existingSecretKey` | string | `dsn` | Key in the existing Secret |
| `database.maxOpenConns` | int | `10` | PostgreSQL connection-pool cap per pod (`JARVIS_DB_MAX_OPEN_CONNS`); ignored for SQLite. Keep `replicaCount × maxOpenConns` well below the server's `max_connections` |
| `auth.provider` | string | `none` | Authentication mode: `none`, `internal`, or `oidc` |
| `auth.mode` | string | `""` | Protection level when provider ≠ `none`: `write_protect` (default) or `full_protect` |
| `auth.secretKey` | string | `""` | JWT signing key (min 32 random bytes). Use `auth.existingSecret` in production. |
| `auth.existingSecret` | string | `""` | Existing K8s Secret with `secret-key` (and `oidc-client-secret` for OIDC) |
| `auth.existingSecretKeys.secretKey` | string | `secret-key` | Key in Secret for `JARVIS_SECRET_KEY` |
| `auth.existingSecretKeys.oidcClientSecret` | string | `oidc-client-secret` | Key in Secret for `JARVIS_AUTH_OIDC_CLIENT_SECRET` |
| `auth.oidc.issuer` | string | `""` | OIDC provider issuer URL |
| `auth.oidc.clientId` | string | `""` | OIDC client ID |
| `auth.oidc.clientSecret` | string | `""` | OIDC client secret (stored in Secret, not ConfigMap) |
| `auth.oidc.redirectUrl` | string | `""` | OIDC redirect URL (must match provider config) |
| `auth.oidc.scopes` | string | `openid,profile,email` | Comma-separated OIDC scopes |
| `persistence.enabled` | bool | `false` | Enable PVC for SQLite storage (single-replica recommended) |
| `persistence.storageClass` | string | `""` | StorageClass name |
| `persistence.accessMode` | string | `ReadWriteOnce` | PVC access mode |
| `persistence.size` | string | `1Gi` | PVC size |
| `resources` | object | `{}` | Resource requests/limits |
| `autoscaling.enabled` | bool | `false` | Enable HPA (requires PostgreSQL — same reasoning as `replicaCount` above) |
| `podDisruptionBudget.enabled` | bool | `false` | Create a `PodDisruptionBudget` — prevents voluntary disruptions (node drains, upgrades) from taking down every replica at once. Meaningful only with `replicaCount`/HPA `> 1` (PostgreSQL) |
| `podDisruptionBudget.minAvailable` | int | `1` | Minimum pods that must stay available during a voluntary disruption |
| `nodeSelector` | object | `{}` | Node selector |
| `tolerations` | list | `[]` | Pod tolerations |
| `affinity` | object | `{}` | Pod affinity rules |
| `topologySpreadConstraints` | list | `[]` | Passed through verbatim to `spec.template.spec.topologySpreadConstraints` — spread replicas across nodes/zones for real HA. Meaningful only with `replicaCount`/HPA `> 1` (PostgreSQL) |
| `extraEnv` | list | `[]` | Additional environment variables for the container |
| `extraVolumes` | list | `[]` | Additional volumes for the Pod |
| `extraVolumeMounts` | list | `[]` | Additional volume mounts for the container |
| `serviceAccountTokenProjection.enabled` | bool | `false` | Mount a projected ServiceAccount token |
| `serviceAccountTokenProjection.volumeName` | string | `workload-token` | Volume and mount name |
| `serviceAccountTokenProjection.mountPath` | string | `/var/run/secrets/workload` | Mount path inside the container |
| `serviceAccountTokenProjection.tokenFileName` | string | `token` | Token file name inside mountPath |
| `serviceAccountTokenProjection.audience` | string | `""` | Token audience (e.g. `vault`). Empty = default Kubernetes audience |
| `serviceAccountTokenProjection.expirationSeconds` | int | `3600` | Token lifetime in seconds (Kubernetes auto-rotates before expiry) |

## Examples

For Kubernetes production deployments, PostgreSQL is recommended.
SQLite (with or without PVC) is mainly intended for single-replica or test setups.

### Minimal (SQLite, ephemeral)

```yaml
clusters:
  - name: production
    alertmanagerUrl: http://alertmanager.monitoring.svc:9093
```

### SQLite with persistent storage

> Recommended only for single-replica setups (`replicaCount: 1`).

```yaml
clusters:
  - name: production
    alertmanagerUrl: http://alertmanager.monitoring.svc:9093

persistence:
  enabled: true
  size: 2Gi
```

### PostgreSQL backend

```yaml
clusters:
  - name: production
    alertmanagerUrl: http://alertmanager.monitoring.svc:9093

database:
  dsn: postgres://jarvis:secret@postgres.monitoring.svc:5432/jarvis?sslmode=require
```

Use an external Secret to avoid storing credentials in values:

```yaml
database:
  existingSecret: jarvis-db-credentials
  existingSecretKey: dsn
```

### Internal authentication

```yaml
auth:
  provider: internal
  secretKey: "$(openssl rand -hex 32)"   # replace with actual generated value
```

Or with an external Secret (recommended for production):

```bash
kubectl create secret generic jarvis-auth \
  --from-literal=secret-key=$(openssl rand -hex 32)
```

```yaml
auth:
  provider: internal
  existingSecret: jarvis-auth
```

### OIDC authentication

```bash
kubectl create secret generic jarvis-auth \
  --from-literal=secret-key=$(openssl rand -hex 32) \
  --from-literal=oidc-client-secret=<your-client-secret>
```

```yaml
auth:
  provider: oidc
  existingSecret: jarvis-auth
  oidc:
    issuer: https://keycloak.example.com/realms/myrealm
    clientId: jarvis
    redirectUrl: https://jarvis.example.com/auth/oidc/callback
```

For provider-specific setup (Keycloak, Authentik) see [docs/authentication-user.md](../../docs/authentication-user.md).

### Multiple clusters

```yaml
clusters:
  - name: staging
    alertmanagerUrl: http://alertmanager-staging:9093
    prometheusUrl: http://prometheus-staging:9090
  - name: production
    alertmanagerUrl: http://alertmanager-prod:9093
    prometheusUrl: http://prometheus-prod:9090
    hostAlias: https://alertmanager.prod.example.com
```

### Ingress with WebSocket support

Jarvis uses WebSocket (`/ws`) for live alert updates. The ingress must not strip or block the `Upgrade` / `Connection` headers.

#### ingress-nginx

ingress-nginx requires explicit WebSocket annotations:

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-http-version: "1.1"
    nginx.ingress.kubernetes.io/configuration-snippet: |
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
  hosts:
    - host: jarvis.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: jarvis-tls
      hosts:
        - jarvis.example.com

config:
  allowedOrigins: "https://jarvis.example.com"
```

### Vault JWT auth with projected ServiceAccount token

Use `serviceAccountTokenProjection` to obtain a short-lived, audience-scoped token without relying on the pod-level `automountServiceAccountToken`. Pair it with `extraEnv` to point the app at the token file.

Note: `automountServiceAccountToken` on the pod is otherwise driven by `leaderElection.podLabel.enabled` (default `true` — the leader pod label needs the default token to call the Kubernetes API, see the values table above). Set `leaderElection.podLabel.enabled: false` too if you want only the projected workload token mounted and nothing else.

```yaml
serviceAccount:
  create: true
  # Annotate with the Vault role when using the Vault Agent Injector or the
  # Kubernetes auth backend directly.
  annotations:
    vault.hashicorp.com/role: jarvis

# Skip mounting the default token entirely — only the projected workload
# token below is needed.
leaderElection:
  podLabel:
    enabled: false

serviceAccountTokenProjection:
  enabled: true
  volumeName: workload-token
  mountPath: /var/run/secrets/workload
  tokenFileName: token
  audience: vault          # must match the Vault Kubernetes auth backend audience
  expirationSeconds: 3600

extraEnv:
  - name: VAULT_TOKEN_FILE
    value: /var/run/secrets/workload/token
  - name: VAULT_ADDR
    value: https://vault.example.com
```

The token at `/var/run/secrets/workload/token` is a standard Kubernetes `serviceAccountToken` projection — Vault's [Kubernetes auth method](https://developer.hashicorp.com/vault/docs/auth/kubernetes) accepts it directly via the `jwt` login path.

#### Traefik (v2 / v3)

Traefik forwards WebSocket connections out of the box — no extra annotations are required. Only add annotations if you need HTTPS redirect or custom middleware:

```yaml
ingress:
  enabled: true
  className: traefik
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: websecure
    traefik.ingress.kubernetes.io/router.tls: "true"
  hosts:
    - host: jarvis.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: jarvis-tls
      hosts:
        - jarvis.example.com

config:
  allowedOrigins: "https://jarvis.example.com"
```
