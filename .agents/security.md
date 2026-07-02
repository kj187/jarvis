# Jarvis — Security Check

On-demand security review — everything the pre-commit hook does, runnable
manually. Also useful before a release or after larger changes. The
user-facing description of the security measures built into the application is
`docs/security.md`; this file is the agent-facing checklist and tooling
reference.

---

## Run Tools

```bash
# Go Backend
cd backend

gosec ./...             # Security scanner: hardcoded credentials, SQL injection,
                        # path traversal, weak crypto, insecure random, etc.

govulncheck ./...       # CVE check: dependencies against Go Vulnerability DB

golangci-lint run       # Linter suite: errcheck, bodyclose, noctx, staticcheck, unused, ...

go mod verify           # Verify module checksums against go.sum

go test -race ./...     # Race detector — surfaces data races

# Frontend
cd frontend
pnpm audit              # Check frontend deps for known CVEs

# Secret scanning (gitleaks, config: .gitleaks.toml — runs via podman)
make scan               # scan all source files
make scan-history       # scan full git history
make scan-staged        # scan staged changes (mirrors pre-commit behavior)
make scan-all           # all three

# Everything at once
make security-all       # gosec + govulncheck + pnpm audit
```

All these tools also run automatically in the **pre-commit hook**
(`.githooks/pre-commit`) and in **CI** (`.github/workflows/ci.yml`). If any
hook step fails, the commit is aborted — never use `--no-verify`.

---

## Container Checklist

```dockerfile
# The following must be present in the Containerfile:
FROM gcr.io/distroless/static-debian12   # Distroless — no shell
USER nonroot:nonroot                      # Non-root user
```

```yaml
# compose.yml security options:
security_opt:
  - no-new-privileges:true
cap_drop:
  - ALL
read_only: true
tmpfs:
  - /tmp
```

---

## New Code Checklist

### Go

- [ ] No hardcoded secrets/credentials (gosec G-codes)
- [ ] HTTP client calls have `context.WithTimeout` (gosec G114 / noctx linter)
- [ ] HTTP response body is closed (`defer resp.Body.Close()`) (bodyclose linter)
- [ ] Error responses do not leak internal details (`c.JSON(500, "internal error")`)
- [ ] Fingerprint parameter validated: format `[a-f0-9]{16}`
- [ ] Pagination parameters: `limit` ≤ 100, `offset` ≥ 0
- [ ] SQL queries use only prepared statements (parameterized queries) — no string concatenation
- [ ] All `error` returns are checked (errcheck linter)
- [ ] `go mod verify` passes cleanly
- [ ] `.env` not committed to git

### Frontend

- [ ] No `dangerouslySetInnerHTML`
- [ ] No `eval()` or dynamic script execution
- [ ] External links have `rel="noopener noreferrer"` (when using `target="_blank"`)
- [ ] TypeScript `strict: true` — no implicit `any`
- [ ] `pnpm audit` shows no critical CVEs

### Configuration

- [ ] `JARVIS_ALLOWED_ORIGINS` is set (no wildcard `*`)
- [ ] `.env.example` contains only placeholders, no real values
- [ ] `JARVIS_DB_DSN` points to a persistent volume (SQLite) or a real DB host (PostgreSQL), not a tmp directory — and is never logged raw (`db.RedactDSN()`)

---

## CORS + WebSocket Origin

The backend validates the `Origin` header for both HTTP CORS and the WebSocket
upgrade against `cfg.AllowedOrigins` (Critical Invariant #11 in `AGENTS.md`).
Never use an unconditional `return true` in `upgrader.CheckOrigin`.

Actual behavior in `internal/ws/hub.go`:

```go
CheckOrigin: func(r *http.Request) bool {
    origin := r.Header.Get("Origin")
    if origin == "" {
        return true // no Origin header — non-browser clients cannot trigger CSRF
    }
    if len(allowedOrigins) == 0 {
        // Same-origin only when no allow-list is configured.
        return origin == "http://"+r.Host || origin == "https://"+r.Host
    }
    _, ok := originSet[origin] // allow-list lookup
    return ok
},
```
