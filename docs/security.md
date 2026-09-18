# Security model

## Overview

Jarvis ships with built-in authentication (see [authentication-user.md](authentication-user.md)).
It assumes deployment behind a trusted reverse proxy (e.g. Traefik, nginx) for TLS termination.
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
