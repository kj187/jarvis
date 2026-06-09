---
description: Run all security tools (gosec, govulncheck, golangci-lint, pnpm audit) and new-code security checklist
---

# Jarvis — Security Check

Slash-Command: `/project:security-check`

On-demand security review — everything the pre-commit hook does, runnable manually. Also useful before a release or after larger changes.

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
```

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
- [ ] `JARVIS_DB_PATH` points to a volume, not a tmp directory

---

## CORS + WebSocket Origin

The backend validates the `Origin` header for both HTTP CORS and the WebSocket upgrade against `cfg.AllowedOrigins`. Never use `return true` in `upgrader.CheckOrigin`.

```go
// Korrekt:
upgrader.CheckOrigin = func(r *http.Request) bool {
    origin := r.Header.Get("Origin")
    for _, allowed := range cfg.AllowedOrigins {
        if origin == allowed { return true }
    }
    return false
}
```

---

## Pre-Commit Hook

The hook at `.githooks/pre-commit` runs automatically before every commit:

```bash
# Enable (once):
git config core.hooksPath .githooks
```

If any step fails → commit is aborted. Do not use `--no-verify`.
