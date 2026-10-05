# Security model

## Overview

Jarvis is an **internal tool** and is not designed for public internet exposure. It should be deployed
behind a VPN or a frontend authentication proxy (e.g. Traefik Forward Auth, oauth2-proxy) that validates
the caller before the request reaches Jarvis.

Given this deployment model, Jarvis ships with built-in authentication (see [authentication-user.md](authentication-user.md))
as a secondary layer. It assumes deployment behind a trusted reverse proxy (e.g. Traefik, nginx) for TLS termination.
This document describes the security measures built into the application itself.

## HTTP Security (Echo Middleware)

All HTTP responses include security headers via Echo's `SecureWithConfig` middleware:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: same-origin`
- `Permissions-Policy` denying camera, microphone, geolocation, payment and USB
- `Strict-Transport-Security` (when served over HTTPS)
- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src
  'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self';
  frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`

`X-XSS-Protection` is no longer sent: browsers dropped the XSS auditor, and the
header could itself introduce vulnerabilities in old ones. Jarvis cannot be
embedded in a frame on another site (or its own); an iframe embed needs a
proxy that rewrites these headers.

The CSP's `connect-src 'self'` means the browser API and WebSocket connection
must be same-origin. A deployment that exposes them under another origin needs
proxy routing that presents them as one origin; the CORS allowlist alone does
not override CSP.

CORS is configured with a strict origin allowlist (`JARVIS_ALLOWED_ORIGINS`).
No wildcard `*` is used. WebSocket upgrades validate the `Origin` header
against the same allowlist. Setting it correctly behind a proxy is described
in [Running behind a proxy](reverse-proxy.md).

**State-changing requests are origin-checked.** `POST`, `PUT`, `PATCH` and
`DELETE` with an `Origin` that is neither this server's host nor in
`JARVIS_ALLOWED_ORIGINS` — and requests without `Origin` that the browser marks
`Sec-Fetch-Site: cross-site` — get `403`. CORS alone only hides the response; a
cross-site form or bodyless `fetch` would still run the handler, so this closes
login CSRF and bodyless writes. Non-browser clients (curl, scripts) send neither
header and are unaffected.

**Host and client IP.** `JARVIS_ALLOWED_HOSTS` (off by default) rejects requests
whose `Host` header is not on the list with `421`, which stops DNS-rebinding and
forged-Host requests from reaching the API. The client IP in the logs is the TCP
peer; `X-Forwarded-For` and `X-Real-IP` only count when the peer is listed in
`JARVIS_TRUSTED_PROXIES`, so a caller cannot choose its own `remote_ip`.

The session cookie is `HttpOnly`, `SameSite=Lax` and `Secure` when the request
is HTTPS or carries `X-Forwarded-Proto: https`. `JARVIS_COOKIE_SECURE=true`
forces `Secure` for a TLS-terminating proxy that does not send that header.

Request bodies are limited to **1 MB**.

---

## Sessions

The session cookie is a signed JWT, but the signature alone is not trusted: every request is checked against the
`users` table (the user must exist, the token's version must match `users.token_version`, and the role is read
from the database). Logout bumps `token_version`, which revokes all of the account's sessions on every replica and
survives restarts; deleting a user or changing a role takes effect immediately on the pod that handled it and
within the 30-second per-pod cache on the others. Open WebSocket connections of a revoked session are closed.
See [Sessions](authentication-user.md#sessions).

---

## Deployment Assumptions

Jarvis' internal-tool deployment model has the following security implications:

**No authentication (`JARVIS_AUTH_PROVIDER=none`, the default)**: there is no login and no write protection. Anyone who can reach Jarvis can read all alerts and create claims, comments and silences, and the silences reach Alertmanager. Jarvis logs a warning at startup in this mode. Keep it behind a VPN or an authenticating proxy, or use `internal` / `oidc` (see [authentication-user.md](authentication-user.md)).

**Rate limiting**: The only rate limit is on `POST /auth/login` — a single global bucket
(30 req/min, burst 10) shared across all clients. On PostgreSQL HA, each pod has its own bucket.
An attacker with network access to the login endpoint can exhaust this bucket and block logins
for all users. However, read access remains available in `write_protect` mode. All other endpoints
(`/poll`, `/setup`, write routes, admin endpoints) have no rate limits.

**`POST /setup`**: This endpoint is open (no authentication, no rate limit) as long as no user exists
in the database. The first admin is created atomically, so concurrent requests cannot create more than one
account; every later request gets `403`. Until setup is complete, anyone who can reach the URL can claim the
instance: set [`JARVIS_SETUP_TOKEN`](configuration.md#jarvis_setup_token) to require a token for the first
admin, complete the setup immediately after deployment, or restrict network access to the endpoint until then.

**`POST /api/v1/poll`**: In `none` mode this endpoint is open; from `write_protect` upward it needs a login like every other
write. Independent of the mode, polls closer together than 5 seconds apart are refused with `429` and a `Retry-After`
header. The interval is global per pod, not per client, so rotating addresses does not get around it, and the recorder's own
`JARVIS_POLL_INTERVAL` keeps the data fresh in between. A refused poll never reaches Alertmanager.

**WebSocket `/ws`**: connections are capped per pod ([`JARVIS_WS_MAX_CONNECTIONS`](configuration.md#jarvis_ws_max_connections),
default 500); one over the cap gets `503`. A client that stops reading is disconnected once its backlog of events is full, and
reconnects on its own.

## Input Validation

- Fingerprint path params: validated against `[a-f0-9]{16}` regex
- Pagination: `limit` accepts 10, 25, 50, or 100; `offset` ≥ 0
- Silence fields: `comment` is required; length limits enforced
- Outbound HTTP (Alertmanager client): 10s timeout on all requests
- JSON decoding uses `DisallowUnknownFields` where appropriate

---

## Credentials in cluster URLs

A `user:password@` in `JARVIS_CLUSTER_N_ALERTMANAGER_URL` (or `PROMETHEUS_URL`)
is removed from everything the browser receives — `/api/v1/clusters`, the
silence links and the Alertmanager link in the UI — and Jarvis logs a warning at
startup. The URL Jarvis polls keeps the credentials. Prefer the cluster auth
settings (basic auth, bearer token), which are kept out of the environment
listing in Kubernetes when they come from a Secret.

## Metrics Endpoint

`GET /metrics` is public by default, like `/health`, and exposes aggregate
operational data and the `host:port` of each Alertmanager member, but never
alert names, labels, or annotations. `JARVIS_METRICS_TOKEN` makes it require a
bearer token. See
[Monitoring and metrics](metrics.md) for the exposure details, setup, and full
metric reference.

---

## Container Security

```dockerfile
FROM gcr.io/distroless/static-debian12   # no shell, minimal attack surface
USER nonroot:nonroot                       # non-root user
```

In production compose:

```yaml
read_only: true
tmpfs:
  - /tmp
security_opt:
  - no-new-privileges:true
cap_drop:
  - ALL
```

## Reporting a Vulnerability

See [SECURITY.md](../SECURITY.md) in the project root.
