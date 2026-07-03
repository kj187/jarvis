# Security

## Overview

Jarvis ships with built-in authentication (see [authentication-user.md](authentication-user.md)).
It assumes deployment behind a trusted reverse proxy (e.g. Traefik, nginx) for TLS termination.
This document describes the security measures built into the application itself.

---

## Static Analysis (Go)

| Tool | Purpose | When |
|---|---|---|
| `gosec` | Hardcoded credentials, SQL injection, path traversal, weak crypto | Pre-Commit + CI (via `golangci-lint`) |
| `govulncheck` | Checks dependencies against the Go Vulnerability DB (CVEs) | CI |
| `golangci-lint` | Aggregator: `gosec`, `errcheck`, `bodyclose`, `noctx`, `staticcheck` | Pre-Commit + CI |

Run manually:

```bash
cd backend
gosec ./...
govulncheck ./...
golangci-lint run ./...
```

---

## HTTP Security (Echo Middleware)

All HTTP responses include security headers via Echo's `SecureWithConfig` middleware:

- `X-XSS-Protection: 1; mode=block`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Strict-Transport-Security` (when served over HTTPS)

CORS is configured with a strict origin allowlist (`JARVIS_ALLOWED_ORIGINS`).
No wildcard `*` is used. WebSocket upgrades validate the `Origin` header
against the same allowlist.

Request bodies are limited to **1 MB**.

---

## Input Validation

- Fingerprint path params: validated against `[a-f0-9]{16}` regex
- Pagination: `limit` capped at 100, `offset` ≥ 0
- Silence fields: `comment` is required; length limits enforced
- Outbound HTTP (Alertmanager client): 10s timeout on all requests
- JSON decoding uses `DisallowUnknownFields` where appropriate

---

## Metrics Endpoint

`GET /metrics` is public by design, like `/health` — it stays reachable even
when `JARVIS_AUTH_MODE=full_protect` is set, so external Prometheus scrapers
never need a login. It exposes only aggregate alert counts, poll/event
counters, and configured cluster names — never alert names, labels, or
annotations. See [docs/metrics.md](metrics.md) for the full metric reference.

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

---

## Dependency Security

- `go mod verify` — validates module checksums against `go.sum`
- `govulncheck ./...` — CVE check in CI on every push and pull request
- `pnpm audit` — frontend dependency CVE check in CI
- Renovate / Dependabot recommended for automated dependency update PRs

---

## Frontend Security

- TypeScript `strict: true`
- No `dangerouslySetInnerHTML` — React escapes all outputs by default
- CSP headers set by the backend
- `pnpm audit` in CI

---

## Secrets Management

- `.env` is listed in `.gitignore` and is never committed
- `.env.example` contains **placeholder values only** (no real secrets)
- No secrets in source code (gosec G-Codes enforce this)
- All configuration via environment variables (12-Factor App)

---

## Reporting a Vulnerability

See [SECURITY.md](../SECURITY.md) in the project root.
