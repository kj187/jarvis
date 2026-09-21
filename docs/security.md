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

- `X-XSS-Protection: 1; mode=block`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Strict-Transport-Security` (when served over HTTPS)
- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src
  'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'`

The CSP's `connect-src 'self'` means the browser API and WebSocket connection
must be same-origin. A deployment that exposes them under another origin needs
proxy routing that presents them as one origin; the CORS allowlist alone does
not override CSP.

CORS is configured with a strict origin allowlist (`JARVIS_ALLOWED_ORIGINS`).
No wildcard `*` is used. WebSocket upgrades validate the `Origin` header
against the same allowlist. Setting it correctly behind a proxy is described
in [Running behind a proxy](reverse-proxy.md).

Request bodies are limited to **1 MB**.

---

## Deployment Assumptions

Jarvis' internal-tool deployment model has the following security implications:

**Rate limiting**: The only rate limit is on `POST /auth/login` — a single global bucket
(30 req/min, burst 10) shared across all clients. On PostgreSQL HA, each pod has its own bucket.
An attacker with network access to the login endpoint can exhaust this bucket and block logins
for all users. However, read access remains available in `write_protect` mode. All other endpoints
(`/poll`, `/setup`, write routes, admin endpoints) have no rate limits.

**`POST /setup`**: This endpoint is open (no authentication, no rate limit) as long as no admin user exists
in the database. Complete the initial setup immediately after deployment, or restrict network access to this
endpoint until setup is complete.

**`POST /api/v1/poll`**: This endpoint is public (no authentication, no rate limit). A hostile client
can hammer it and keep the Alertmanager poll loop running constantly. Read-only access is available in
`write_protect` mode; this endpoint affects performance only, not data integrity.

## Input Validation

- Fingerprint path params: validated against `[a-f0-9]{16}` regex
- Pagination: `limit` accepts 10, 25, 50, or 100; `offset` ≥ 0
- Silence fields: `comment` is required; length limits enforced
- Outbound HTTP (Alertmanager client): 10s timeout on all requests
- JSON decoding uses `DisallowUnknownFields` where appropriate

---

## Metrics Endpoint

`GET /metrics` is public by design, like `/health`, and exposes aggregate
operational data but never alert names, labels, or annotations. See
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
