# Jarvis Helm Chart

Web frontend for Prometheus Alertmanager with persistent alert history, claims, comments, and silence management.

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
| `replicaCount` | int | `1` | Number of replicas |
| `image.repository` | string | `ghcr.io/kj187/jarvis` | Container image repository |
| `image.tag` | string | `""` | Image tag (defaults to chart appVersion) |
| `image.pullPolicy` | string | `IfNotPresent` | Image pull policy |
| `imagePullSecrets` | list | `[]` | Image pull secrets |
| `nameOverride` | string | `""` | Override chart name |
| `fullnameOverride` | string | `""` | Override fully qualified app name |
| `serviceAccount.create` | bool | `true` | Create a ServiceAccount |
| `serviceAccount.annotations` | object | `{}` | ServiceAccount annotations |
| `serviceAccount.name` | string | `""` | ServiceAccount name (auto-generated when empty) |
| `podAnnotations` | object | `{}` | Pod annotations |
| `podSecurityContext` | object | `{runAsNonRoot: true, runAsUser: 65532, ...}` | Pod-level security context |
| `securityContext` | object | `{allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, ...}` | Container-level security context |
| `service.type` | string | `ClusterIP` | Kubernetes Service type |
| `service.port` | int | `80` | Service port |
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
| `database.dsn` | string | `/data/jarvis.db` | Database DSN (SQLite path or `postgres://` URL) |
| `database.existingSecret` | string | `""` | Use an existing Secret for the DSN instead |
| `database.existingSecretKey` | string | `dsn` | Key in the existing Secret |
| `persistence.enabled` | bool | `false` | Enable PVC for SQLite storage |
| `persistence.storageClass` | string | `""` | StorageClass name |
| `persistence.accessMode` | string | `ReadWriteOnce` | PVC access mode |
| `persistence.size` | string | `1Gi` | PVC size |
| `resources` | object | `{}` | Resource requests/limits |
| `autoscaling.enabled` | bool | `false` | Enable HPA |
| `nodeSelector` | object | `{}` | Node selector |
| `tolerations` | list | `[]` | Pod tolerations |
| `affinity` | object | `{}` | Pod affinity rules |

## Examples

### Minimal (SQLite, ephemeral)

```yaml
clusters:
  - name: production
    alertmanagerUrl: http://alertmanager.monitoring.svc:9093
```

### SQLite with persistent storage

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
