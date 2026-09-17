# Configuration

Jarvis is configured entirely through environment variables. There is no
config file. [`.env.example`](https://github.com/kj187/jarvis/blob/main/.env.example)
in the repository is a working template of everything on this page.

Values are read once at startup — a change means a restart.

- [Core](#core)
- [Clusters](#clusters) — the only required settings
- [Alertmanager HA clusters](#alertmanager-ha-clusters)
- [Upstream authentication](#upstream-authentication)
- [Database](#database)
- [User authentication](#user-authentication)
- [Data retention](#data-retention)

---

## Core

| Variable | Default | Description |
|---|---|---|
| <a id="jarvis_port"></a>`JARVIS_PORT` | `8080` | HTTP listen port |
| <a id="jarvis_log_level"></a>`JARVIS_LOG_LEVEL` | `info` | Log verbosity: `info` or `debug` |
| <a id="jarvis_log_requests"></a>`JARVIS_LOG_REQUESTS` | `false` | Log every HTTP request. Noisy — for debugging a proxy or auth problem, not for normal operation |
| <a id="jarvis_poll_interval"></a>`JARVIS_POLL_INTERVAL` | `15s` | How often Alertmanager is polled (Go duration, e.g. `30s`). Also scales the grace period to `max(60s, 2 × interval)` — see [Alert lifecycle](alert-lifecycle.md) |
| <a id="jarvis_allowed_origins"></a>`JARVIS_ALLOWED_ORIGINS` | *(same origin)* | Comma-separated origins allowed for CORS and the WebSocket upgrade, e.g. `https://jarvis.example.com`. Required whenever the browser reaches Jarvis under a different host than the backend itself — see [Running behind a proxy](reverse-proxy.md). No wildcard is accepted |
| <a id="jarvis_runbook_base_url"></a>`JARVIS_RUNBOOK_BASE_URL` | — | Prefix for runbook links. Prepended to the `runbook` label or annotation when its value is not already an absolute URL, e.g. `https://wiki.example.com/runbooks/` |

---

## Clusters

At least one cluster is required; Jarvis refuses to start without it. Repeat
the block with `_2_`, `_3_`, … for more clusters — they are read until the
first gap, so the numbering has to be contiguous.

| Variable | Default | Description |
|---|---|---|
| <a id="jarvis_cluster_n_name"></a>`JARVIS_CLUSTER_1_NAME` | — | Display name, shown in the UI and used in metrics (**required**) |
| <a id="jarvis_cluster_n_alertmanager_url"></a>`JARVIS_CLUSTER_1_ALERTMANAGER_URL` | — | Alertmanager URL as Jarvis reaches it (**required**). A comma-separated list makes this one HA cluster — see [below](#alertmanager-ha-clusters) |
| <a id="jarvis_cluster_n_prometheus_url"></a>`JARVIS_CLUSTER_1_PROMETHEUS_URL` | — | Prometheus URL, used for the "source" links on an alert |
| <a id="jarvis_cluster_n_host_alias"></a>`JARVIS_CLUSTER_1_HOST_ALIAS` | — | The Alertmanager URL as the *browser* reaches it, when that differs from the internal one. One value applies to every member; a comma-separated list matching the member count sets one alias per member, in the same order |

```env
JARVIS_CLUSTER_1_NAME=dev
JARVIS_CLUSTER_1_ALERTMANAGER_URL=http://am-dev.example.com:9093
JARVIS_CLUSTER_1_PROMETHEUS_URL=http://prom-dev.example.com:9090

JARVIS_CLUSTER_2_NAME=prod
JARVIS_CLUSTER_2_ALERTMANAGER_URL=http://am.prod.example.com:9093
```

---

## Alertmanager HA clusters

Alertmanager's HA mode runs two or more instances in a gossip cluster:
Prometheus sends every alert to all of them, and silences replicate between
them. Point one Jarvis cluster at all members by listing them
comma-separated. Jarvis polls every member, deduplicates alerts by
fingerprint (the freshest `updatedAt` wins), and keeps the cluster healthy as
long as at least one member answers.

```env
JARVIS_CLUSTER_2_NAME=prod
JARVIS_CLUSTER_2_ALERTMANAGER_URL=http://am1.prod:9093,http://am2.prod:9093,http://am3.prod:9093
JARVIS_CLUSTER_2_PROMETHEUS_URL=http://prom.prod:9090
```

What to know about it:

- **Authentication is per cluster, not per member.** HA replicas share one
  auth setup in practice: Jarvis fetches a single OAuth2 token and presents it
  to every member, so all of them must accept tokens from that issuer.
  Members with genuinely different credentials are not supported — align the
  auth, or configure such a member as its own cluster (which brings back
  duplicate alerts).
- **`HOST_ALIAS` takes one value or exactly as many as there are members.**
  Anything in between is a startup error. Useful when each member is reachable
  on its own port locally:
  ```env
  JARVIS_CLUSTER_2_ALERTMANAGER_URL=http://test-alertmanager:9093,http://test-alertmanager-2:9093
  JARVIS_CLUSTER_2_HOST_ALIAS=http://localhost:9094,http://localhost:9095
  ```
- **Silences are written to the first healthy member** in configuration order,
  retrying once against the next one on a transport failure. Never to all of
  them — gossip already replicates, and writing everywhere would create
  duplicate silences.
- A member is identified by its `host:port` in the UI, in metrics and in an
  alert's `seenOn` list.
- Duplicate member URLs inside one cluster are a startup error.

---

## Upstream authentication

For an Alertmanager behind an authentication proxy. All of these are per
cluster and apply to every member alike.

| Variable | Description |
|---|---|
| <a id="jarvis_cluster_n_oauth2_client_id"></a>`JARVIS_CLUSTER_1_OAUTH2_CLIENT_ID` | OAuth2 client ID (`client_credentials` grant, tokens refreshed automatically) |
| <a id="jarvis_cluster_n_oauth2_client_secret"></a>`JARVIS_CLUSTER_1_OAUTH2_CLIENT_SECRET` | OAuth2 client secret — never logged. Required with `OAUTH2_CLIENT_ID` |
| <a id="jarvis_cluster_n_oauth2_token_url"></a>`JARVIS_CLUSTER_1_OAUTH2_TOKEN_URL` | Token endpoint. Required with `OAUTH2_CLIENT_ID` |
| <a id="jarvis_cluster_n_oauth2_scopes"></a>`JARVIS_CLUSTER_1_OAUTH2_SCOPES` | Comma-separated scopes |
| <a id="jarvis_cluster_n_bearer_token"></a>`JARVIS_CLUSTER_1_BEARER_TOKEN` | Static token, sent as `Authorization: Bearer <token>` |
| <a id="jarvis_cluster_n_basic_auth_user"></a>`JARVIS_CLUSTER_1_BASIC_AUTH_USER` | HTTP basic auth user |
| <a id="jarvis_cluster_n_basic_auth_password"></a>`JARVIS_CLUSTER_1_BASIC_AUTH_PASSWORD` | HTTP basic auth password — never logged |
| <a id="jarvis_cluster_n_header"></a>`JARVIS_CLUSTER_1_HEADER_<name>` | Custom request header, repeat for several |

**Priority when more than one is set:** OAuth2 → bearer token → basic auth →
custom headers. OAuth2 is the recommended option because the token is
refreshed for you. Provider setup, including a worked Keycloak example and the
Helm chart's `clusters[].auth` values, is in
[Alertmanager authentication](authentication-alertmanager.md).

---

## Database

| Variable | Default | Description |
|---|---|---|
| <a id="jarvis_db_dsn"></a>`JARVIS_DB_DSN` | `/data/jarvis.db` | Selects the backend *and* the connection: a file path means SQLite, a `postgres://` URL means PostgreSQL. Never logged in full — the password is redacted |
| <a id="jarvis_db_max_open_conns"></a>`JARVIS_DB_MAX_OPEN_CONNS` | `10` | PostgreSQL connection pool cap. Ignored on SQLite, which is deliberately limited to a single writer |

```env
JARVIS_DB_DSN=/data/jarvis.db
# or
JARVIS_DB_DSN=postgres://jarvis:secret@postgres:5432/jarvis?sslmode=require
```

**SQLite is the default and is meant for evaluation, homelabs and any
single-replica deployment** — it needs no setup at all. Use PostgreSQL for
production, for high availability and whenever you want more than one replica.

Schema, migrations, TLS, multi-replica leader election and failover, and
Kubernetes deployment including a CloudNativePG example are covered in
[PostgreSQL & HA](postgres-ha.md).

---

## User authentication

| Variable | Default | Description |
|---|---|---|
| <a id="jarvis_auth_provider"></a>`JARVIS_AUTH_PROVIDER` | `none` | `none`, `internal` or `oidc` |
| <a id="jarvis_auth_mode"></a>`JARVIS_AUTH_MODE` | `write_protect` | Applies when the provider is not `none`. `write_protect` lets anyone read and requires a login to change anything; `full_protect` requires a login for everything |
| <a id="jarvis_secret_key"></a>`JARVIS_SECRET_KEY` | — | Signing key for session tokens, at least 32 bytes. Required for `internal` and `oidc` |
| <a id="jarvis_auth_oidc_issuer"></a>`JARVIS_AUTH_OIDC_ISSUER` | — | Issuer URL (required for `oidc`) |
| <a id="jarvis_auth_oidc_client_id"></a>`JARVIS_AUTH_OIDC_CLIENT_ID` | — | Client ID (required for `oidc`) |
| <a id="jarvis_auth_oidc_client_secret"></a>`JARVIS_AUTH_OIDC_CLIENT_SECRET` | — | Client secret (required for `oidc`) |
| <a id="jarvis_auth_oidc_redirect_url"></a>`JARVIS_AUTH_OIDC_REDIRECT_URL` | — | Callback URL, must match the provider's configuration (required for `oidc`) |
| <a id="jarvis_auth_oidc_scopes"></a>`JARVIS_AUTH_OIDC_SCOPES` | `openid,profile,email` | Comma-separated scopes |
| <a id="jarvis_oidc_admin_claim"></a>`JARVIS_OIDC_ADMIN_CLAIM` | — | Token claim that decides who is an admin, e.g. `groups`. Without it every OIDC user gets the `user` role |
| <a id="jarvis_oidc_admin_value"></a>`JARVIS_OIDC_ADMIN_VALUE` | — | The value that claim must contain, e.g. `jarvis-admins` |

```env
JARVIS_AUTH_PROVIDER=internal
JARVIS_SECRET_KEY=<openssl rand -hex 32>
```

With `internal`, the first visit redirects to `/setup` to create the admin
account; further users are managed at `/admin/users`. Provider setup for
Keycloak and Authentik, the OIDC flow, role mapping, session details and
Kubernetes secrets are in [User authentication](authentication-user.md).

---

## Data retention

Off by default: Jarvis keeps history forever unless you tell it otherwise.

| Variable | Default | Description |
|---|---|---|
| <a id="jarvis_retention_days"></a>`JARVIS_RETENTION_DAYS` | — | Fallback age limit for every history type. `0` or unset disables the sweep entirely |
| <a id="jarvis_retention_events_days"></a>`JARVIS_RETENTION_EVENTS_DAYS` | *(inherits)* | Alert lifecycle events |
| <a id="jarvis_retention_claims_days"></a>`JARVIS_RETENTION_CLAIMS_DAYS` | *(inherits)* | Released claims |
| <a id="jarvis_retention_silence_events_days"></a>`JARVIS_RETENTION_SILENCE_EVENTS_DAYS` | *(inherits)* | Silence events |
| <a id="jarvis_retention_comments_days"></a>`JARVIS_RETENTION_COMMENTS_DAYS` | `0` (kept forever) | Comments — **never** inherits `JARVIS_RETENTION_DAYS`; only an explicit value here enables deletion |
| <a id="jarvis_retention_sweep_interval"></a>`JARVIS_RETENTION_SWEEP_INTERVAL` | `12h` | How often the sweep runs |

What exactly gets deleted, in which order, and how this affects per-cluster
statistics is described in [Data retention](retention.md).
