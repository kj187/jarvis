# Jarvis

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/kj187/jarvis)](https://github.com/kj187/jarvis/releases/latest)
[![CI](https://github.com/kj187/jarvis/actions/workflows/ci.yml/badge.svg)](https://github.com/kj187/jarvis/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/kj187/jarvis/badge)](https://scorecard.dev/viewer/?uri=github.com/kj187/jarvis)
[![OpenSSF Baseline](https://www.bestpractices.dev/projects/13469/baseline)](https://www.bestpractices.dev/projects/13469)
[![Coverage](https://codecov.io/gh/kj187/jarvis/graph/badge.svg)](https://codecov.io/gh/kj187/jarvis)

**Jarvis** is an open source web frontend for Prometheus Alertmanager — interactive, realtime, and self-hosted.

It was inspired by [Karma](https://github.com/prymitive/karma), which is a great project. However, I was missing features that matter for day-to-day on-call work: full persistence across restarts, the ability to comment on individual alerts, a claiming system so the team knows who is handling what, and a solid foundation to build further operational tooling on top of. Jarvis is the result.

 ![Jarvis Screenshot](docs/assets/screenshot.png)

## Why Jarvis?

Most Alertmanager UIs are read-only dashboards. Jarvis is built for teams that need to *act* on alerts, not just observe them:

- **Realtime alerts** via WebSocket — no page reload required
- **Persistent history** — full alert lifecycle stored in SQLite or PostgreSQL (firing → suppressed → resolved)
- **Claiming** — assign an alert to yourself so the team sees who is on it
- **Comments** — fingerprint-bound notes that survive restarts and re-fires
- **Alert Detail Panel** — labels, annotations, link buttons, firing history, stats, claim, comments, AI-prompt
- **Alerts & Silences pages** — dedicated nav tabs, each with card / list view and a distraction-free fullscreen mode
- **Card and List View** — custom grouping by label (configured in Settings), per-group expand/collapse, drag-and-drop section reordering, sortable list columns
- **Label-based filtering** — `=` / `!=` / `=~` / `!~` matcher chips, URL-serialized
- **Silences** — dedicated management page: grouping, show/hide expired, sort, create, edit, extend, delete, re-create; full Alertmanager proxy
- **Fast-Silence** — one-click, form-free silence on any active alert; hover the button, pick a duration (5m to 1w)
- **Silence templates** — reusable matcher sets for recurring maintenance windows
- **Alert search** — full-text search across alert names and label values; results update as you type
- **Dark / Light theme** — toggle between dark and light mode; preference is persisted in localStorage
- **Multi-cluster** — poll multiple Alertmanager instances simultaneously
- **Alertmanager HA** — point one cluster at all members of an Alertmanager HA gossip cluster; alerts are deduplicated by fingerprint and the cluster stays healthy as long as any member responds
- **Per-cluster upstream auth** — authenticate against protected Alertmanagers via OAuth2 client credentials (auto-refresh), bearer token, basic auth or custom headers
- **Grace period** — ghost-resolve prevention scaled to the poll interval (`max(60s, 2 × poll interval)`)
- **Single binary** — Go backend embeds the Vite build; one container
- **User authentication** — optional UI login, three modes: `none` (open), `internal` (built-in user management with admin panel), `oidc` (Keycloak, Authentik, Dex, any OIDC provider)

Worried about feature creep? Jarvis has a deliberately focused scope — what it is and what it will never become is written down in **[docs/scope.md](docs/scope.md)**.

### Built with AI
> Jarvis was developed entirely using AI coding assistants. This is an intentional workflow choice, not a shortcut: the codebase follows established Go and React best practices, enforces security standards through automated tooling (gosec, govulncheck, golangci-lint, pnpm audit) on every commit and in CI, and applies defense-in-depth measures (strict CSP, read-only container filesystem, no-new-privileges). See [SECURITY.md](SECURITY.md) for details.

## Features

Card view, list view, label filters, silence management, alert history, detail panel, user settings, and more — see **[docs/features.md](docs/features.md)** for the full feature reference.


## Getting Started

**No clone needed — runs entirely from the published image.**


All you need is Podman or Docker — no installation, no build step. Create a `compose.yml` and adjust the Alertmanager URL to point to your instance:

```yaml
services:
  jarvis:
    image: ghcr.io/kj187/jarvis:1.9.2
    ports:
      - "8080:8080"
    volumes:
      - jarvis_data:/data
    environment:
      JARVIS_CLUSTER_1_NAME: dev
      JARVIS_CLUSTER_1_ALERTMANAGER_URL: http://alertmanager:9093
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL

volumes:
  jarvis_data:
```

> Works with both Podman and Docker — replace `podman` with `docker` in all commands if needed.

```bash
podman compose up -d
```

Now open http://localhost:8080


**Kubernetes / Helm:**

```bash
helm install jarvis oci://ghcr.io/kj187/charts/jarvis \
  --version 1.9.2 \
  --set clusters[0].name=dev \
  --set clusters[0].alertmanagerUrl=http://alertmanager:9093 \
  --set database.dsn='postgres://jarvis:secret@postgres.monitoring.svc:5432/jarvis?sslmode=require'
```

> For Kubernetes production deployments (multi-replica, HA), use PostgreSQL —
> see [docs/persistence.md](docs/persistence.md). SQLite + PVC is single-replica only.

All configuration options → [Configuration](#configuration) · [User Authentication](#user-authentication) · [Helm chart](#kubernetes--helm)


## Configuration

See [.env.example](.env.example) for all options. Key settings:

**Core**

| Variable | Default | Description |
|---|---|---|
| `JARVIS_PORT` | `8080` | HTTP listen port |
| `JARVIS_LOG_LEVEL` | `info` | Log verbosity: `info` or `debug` |
| `JARVIS_POLL_INTERVAL` | `15s` | Alertmanager poll interval (Go duration, e.g. `30s`) |
| `JARVIS_DB_DSN` | `/data/jarvis.db` | Database DSN — SQLite file path **or** `postgres://` URL (see below) |
| `JARVIS_ALLOWED_ORIGINS` | _(same-origin)_ | Comma-separated allowed CORS / WebSocket origins (e.g. `https://jarvis.example.com`). Required when browser URL differs from backend host. |
| `JARVIS_RUNBOOK_BASE_URL` | — | Base URL for runbook links. Appended to the `runbook` label/annotation value when it is not already an absolute URL (e.g. `https://wiki.example.com/runbooks/`) |

**User authentication** — see [docs/authentication-user.md](docs/authentication-user.md) for full details

| Variable | Default | Description |
|---|---|---|
| `JARVIS_AUTH_PROVIDER` | `none` | Authentication mode: `none`, `internal`, or `oidc` |
| `JARVIS_AUTH_MODE` | `write_protect` | Protection level when provider ≠ `none`: `write_protect` or `full_protect` |
| `JARVIS_SECRET_KEY` | — | JWT signing key, min 32 bytes (required for `internal` / `oidc`) |
| `JARVIS_AUTH_OIDC_ISSUER` | — | OIDC provider issuer URL (required for `oidc`) |
| `JARVIS_AUTH_OIDC_CLIENT_ID` | — | OIDC client ID (required for `oidc`) |
| `JARVIS_AUTH_OIDC_CLIENT_SECRET` | — | OIDC client secret (required for `oidc`) |
| `JARVIS_AUTH_OIDC_REDIRECT_URL` | — | OIDC callback URL, must match provider config (required for `oidc`) |
| `JARVIS_AUTH_OIDC_SCOPES` | `openid,profile,email` | Comma-separated OIDC scopes |

**Clusters** (repeat for N = 1, 2, 3, …)

| Variable | Default | Description |
|---|---|---|
| `JARVIS_CLUSTER_1_NAME` | — | Cluster display name (**required**) |
| `JARVIS_CLUSTER_1_ALERTMANAGER_URL` | — | Internal Alertmanager URL (**required**). Comma-separated list of member URLs for an Alertmanager HA gossip cluster — see [HA clusters](#ha-alertmanager-clusters) below |
| `JARVIS_CLUSTER_1_PROMETHEUS_URL` | — | Internal Prometheus URL (optional) |
| `JARVIS_CLUSTER_1_HOST_ALIAS` | — | Browser-visible AM URL when different from internal (optional). One value applies to all members; a comma-separated list matching the member count sets one alias per member (index-matched) |
| `JARVIS_CLUSTER_1_OAUTH2_CLIENT_ID` | — | OAuth2 client ID (client_credentials grant — auto token refresh, optional) |
| `JARVIS_CLUSTER_1_OAUTH2_CLIENT_SECRET` | — | OAuth2 client secret (never logged, required with `OAUTH2_CLIENT_ID`) |
| `JARVIS_CLUSTER_1_OAUTH2_TOKEN_URL` | — | OAuth2 token endpoint URL (required with `OAUTH2_CLIENT_ID`) |
| `JARVIS_CLUSTER_1_OAUTH2_SCOPES` | — | Comma-separated OAuth2 scopes (optional, e.g. `openid,profile`) |
| `JARVIS_CLUSTER_1_BEARER_TOKEN` | — | Static bearer token sent as `Authorization: Bearer <token>` (optional) |
| `JARVIS_CLUSTER_1_BASIC_AUTH_USER` | — | HTTP Basic Auth username (optional) |
| `JARVIS_CLUSTER_1_BASIC_AUTH_PASSWORD` | — | HTTP Basic Auth password (optional, never logged) |
| `JARVIS_CLUSTER_1_HEADER_<name>` | — | Custom request header `<name>` sent to Alertmanager (optional, repeat for multiple) |

Add additional clusters with `JARVIS_CLUSTER_2_*`, `JARVIS_CLUSTER_3_*`, etc.

When Alertmanager sits behind an authentication proxy (e.g. oauth2-proxy), use `OAUTH2_*` for dynamic token management (recommended) or `BEARER_TOKEN` / `BASIC_AUTH_*` for static credentials. Priority: `OAuth2 > BEARER_TOKEN > BASIC_AUTH > HEADER_*`. For full details and Keycloak setup see [docs/authentication-alertmanager.md](docs/authentication-alertmanager.md).

#### HA Alertmanager clusters

Alertmanager's HA mode runs 2+ instances in a gossip cluster: Prometheus sends every alert to all members, and silences replicate between members via gossip. Point one Jarvis cluster at all members by passing a comma-separated list in `ALERTMANAGER_URL` — Jarvis polls every member, deduplicates alerts by fingerprint (freshest `updatedAt` wins), and keeps the cluster healthy as long as at least one member responds:

```env
# Cluster 1 — dev, single member (exactly today's syntax, unchanged)
JARVIS_CLUSTER_1_NAME=dev
JARVIS_CLUSTER_1_ALERTMANAGER_URL=http://am-dev.example.com:9093
JARVIS_CLUSTER_1_PROMETHEUS_URL=http://prom-dev.example.com:9090

# Cluster 2 — prod, HA cluster with 3 members (comma-separated list)
JARVIS_CLUSTER_2_NAME=prod
JARVIS_CLUSTER_2_ALERTMANAGER_URL=http://am1.prod.example.com:9093,http://am2.prod.example.com:9093,http://am3.prod.example.com:9093
JARVIS_CLUSTER_2_PROMETHEUS_URL=http://prom.prod.example.com:9090
JARVIS_CLUSTER_2_OAUTH2_CLIENT_ID=jarvis
JARVIS_CLUSTER_2_OAUTH2_CLIENT_SECRET=<secret>
JARVIS_CLUSTER_2_OAUTH2_TOKEN_URL=https://keycloak.example.com/realms/prod/protocol/openid-connect/token
JARVIS_CLUSTER_2_OAUTH2_SCOPES=alertmanager.read alertmanager.write
```

Notes:

- Auth (`OAUTH2_*`, `BEARER_TOKEN`, `BASIC_AUTH_*`, `HEADER_*`) is per **cluster** and applies to all members alike — HA members share the same auth setup in practice. OAuth2 settings describe the IdP, not the members: Jarvis fetches one token from `OAUTH2_TOKEN_URL` and presents it to every member, so all members must accept tokens from that IdP (true by default for real HA replicas behind the same ingress/proxy). Members with genuinely different auth are not supported in v1 — align the auth, or configure such a member as its own separate cluster (which reintroduces duplicate alerts).
- `HOST_ALIAS` can be a single value (applies to all members — e.g. one shared load balancer/ingress URL) or a comma-separated list matching the member count, one alias per member in the same order as `ALERTMANAGER_URL`. Useful for local testing where each member is reachable on a different `localhost` port:
  ```env
  JARVIS_CLUSTER_2_ALERTMANAGER_URL=http://test-alertmanager:9093,http://test-alertmanager-2:9093
  JARVIS_CLUSTER_2_HOST_ALIAS=http://localhost:9094,http://localhost:9095
  ```
  A mismatched count (not 1, not exactly the member count) is a startup error.
- A member is identified by its `host:port` in the UI, metrics, and the alert's `seenOn` list.
- Silence writes go to the first healthy member (config order), retrying once against the next member on transport failure — never to all members, since gossip already replicates and posting to every member would create duplicate silences.
- Duplicate member URLs within one cluster are a startup error.

### Database

`JARVIS_DB_DSN` selects both the backend and the connection:

```env
JARVIS_DB_DSN=/data/jarvis.db
# or
JARVIS_DB_DSN=postgres://jarvis:secret@postgres:5432/jarvis?sslmode=require
```

**SQLite (default) is for testing, evaluation, and homelab-scale
single-replica deployments — zero setup required. For production, high
availability, horizontal scaling (`replicaCount`/HPA `> 1`), and long-term
stability, use PostgreSQL.** Schema, migration, TLS, DSN redaction,
multi-replica leader election/failover, and Kubernetes deployment guidance
(incl. a CloudNativePG example) all live in the canonical guide:
**[docs/persistence.md](docs/persistence.md)**.

## User Authentication

Jarvis ships with built-in user authentication (UI login). Three modes are available, set via `JARVIS_AUTH_PROVIDER`:

| Mode | Description |
|------|-------------|
| `none` | No login (default). Write actions are publicly accessible. Fine for private networks. |
| `internal` | Local accounts with bcrypt passwords. First-run wizard creates the admin account. |
| `oidc` | Delegate login to Keycloak, Authentik, Dex, or any OIDC provider. |

When using `internal` or `oidc`, `JARVIS_AUTH_MODE` controls the protection level:

| Auth Mode | Description |
|-----------|-------------|
| `write_protect` | (default) Unauthenticated users can view alerts read-only; write operations require login. |
| `full_protect` | All routes require login. Unauthenticated users see only the login page. |

**Quick start — internal accounts (write_protect):**

```env
JARVIS_AUTH_PROVIDER=internal
JARVIS_SECRET_KEY=$(openssl rand -hex 32)
# JARVIS_AUTH_MODE=write_protect  ← default, omit or set explicitly
```

**Quick start — internal accounts (full_protect):**

```env
JARVIS_AUTH_PROVIDER=internal
JARVIS_SECRET_KEY=$(openssl rand -hex 32)
JARVIS_AUTH_MODE=full_protect
```

On first access Jarvis redirects to `/setup` where the admin account is created. Additional users are managed via the admin panel at `/admin/users`.

**Quick start — OIDC:**

```env
JARVIS_AUTH_PROVIDER=oidc
JARVIS_SECRET_KEY=$(openssl rand -hex 32)
JARVIS_AUTH_OIDC_ISSUER=https://keycloak.example.com/realms/myrealm
JARVIS_AUTH_OIDC_CLIENT_ID=jarvis
JARVIS_AUTH_OIDC_CLIENT_SECRET=<client-secret>
JARVIS_AUTH_OIDC_REDIRECT_URL=https://jarvis.example.com/auth/oidc/callback
```

For the full reference — provider setup, OIDC flow, role mapping, Kubernetes secrets, session details — see **[docs/authentication-user.md](docs/authentication-user.md)**.

For Alertmanager upstream auth (OAuth2 client credentials, bearer token, basic auth) see **[docs/authentication-alertmanager.md](docs/authentication-alertmanager.md)**.

For a threat model and full security discussion see [docs/security.md](docs/security.md).

---

## Kubernetes / Helm

Jarvis ships a Helm chart published to GHCR as an OCI artifact alongside the Docker image. No separate Helm registry is needed.

For multi-replica/HA deployments (any `replicaCount`, HPA, `PodDisruptionBudget`, leader election, failover), use PostgreSQL — see [docs/persistence.md](docs/persistence.md). SQLite + PVC is single-replica only; the chart fails fast if that's misconfigured.

```bash
helm install jarvis oci://ghcr.io/kj187/charts/jarvis \
  --version <version> \
  --set clusters[0].name=production \
  --set clusters[0].alertmanagerUrl=http://alertmanager:9093
```

For a full values reference, installation examples (SQLite with PVC, PostgreSQL, multi-cluster, ingress-nginx with WebSocket), and upgrade instructions see [charts/jarvis/README.md](charts/jarvis/README.md).


## Supported Alertmanager Versions

Jarvis uses the **Alertmanager HTTP API v2** exclusively (`/api/v2/alerts`, `/api/v2/silences`, `/api/v2/status`). API v2 was introduced in Alertmanager **0.16.0**.

| Requirement | Version |
|---|---|
| Minimum | 0.16.0 |
| Tested with | 0.27.x · 0.28.x |

Any release shipping API v2 should work. If you run into a compatibility issue with a specific version, please [open an issue](https://github.com/kj187/jarvis/issues).

## Development

> Works with both Podman and Docker — replace `podman` with `docker` in all commands if needed.

```bash
git clone https://github.com/kj187/jarvis.git
cd jarvis

# Copy and configure environment
cp .env.example .env
# Edit .env — set at minimum JARVIS_CLUSTER_1_ALERTMANAGER_URL

# Activate pre-commit hooks (once after clone)
git config core.hooksPath .githooks

# Start development stack (hot-reload)
podman compose -f compose.dev.yml up
# Frontend: http://localhost:5173
# Backend:  http://localhost:8080

# Production build
podman compose up --build -d
# http://localhost:8080
```

### Running tests

Quick reference — for the full test strategy, matrix, utilities, and CI pipeline, see [.agents/testing.md](.agents/testing.md).

```bash
make test-all        # backend (go test -race) + frontend functional E2E + helm lint + helm unittest
make test-backend    # go test -race ./...
make test-frontend   # functional E2E (none + internal + oidc)
make helm-lint       # helm lint charts/jarvis/
make helm-test       # helm unittest charts/jarvis/
```

**E2E & screenshots:** See [docs/testing-e2e.md](docs/testing-e2e.md) for the isolated Podman stack, fixture setup, and screenshot generation.

Helm unit tests run without a Kubernetes cluster. Install the plugin once:

```bash
helm plugin install https://github.com/helm-unittest/helm-unittest --version v0.8.2
```


## Tech Stack
[![Go Version](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go)](backend/go.mod)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](frontend/package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](frontend/tsconfig.json)
[![Helm](https://img.shields.io/badge/Helm-chart-0F1689?logo=helm&logoColor=white)](charts/jarvis/)


- **Backend**: Go 1.25 · Echo v4 · SQLite / PostgreSQL (`pgx/v5`, CGO-free) · gorilla/websocket
- **Frontend**: React 19 · TypeScript 6 · Vite 8 · Tailwind CSS v4 · Zustand v5 · TanStack Query v5
- **Infrastructure**: Podman multi-stage build · distroless/static-debian12

## Documentation

- [docs/architecture.md](docs/architecture.md) — data-flow overview: who talks to whom, and when (with diagram)
- [docs/persistence.md](docs/persistence.md) — database backends, multi-replica HA (leader election, snapshot distribution, failover), Kubernetes deployment, SQLite → PostgreSQL migration (with diagrams)
- [docs/alert-lifecycle.md](docs/alert-lifecycle.md) — alert lifecycle: state machine, grace period, episodes, restart/outage guarantees (with diagram)
- [docs/authentication-user.md](docs/authentication-user.md) — user login: providers (none / internal / OIDC), first-run wizard, roles, sessions, Helm
- [docs/authentication-alertmanager.md](docs/authentication-alertmanager.md) — Alertmanager upstream auth: OAuth2 client credentials, bearer token, basic auth, custom headers
- [docs/metrics.md](docs/metrics.md) — Prometheus `/metrics` endpoint: exported metrics, scrape config, ServiceMonitor
- [docs/retention.md](docs/retention.md) — optional data-retention sweep: what gets deleted, `JARVIS_RETENTION_*` config, sweep order
- [AGENTS.md](AGENTS.md) — AI-agent entry point: conventions, critical invariants, task router
- [.agents/testing.md](.agents/testing.md) — full test strategy, matrix, and CI pipeline
- [docs/security.md](docs/security.md) — security measures
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution guidelines
- [SECURITY.md](SECURITY.md) — responsible disclosure

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details on the development workflow, pull request process, and coding standards.

## License

Apache 2.0 — see [LICENSE](LICENSE)
