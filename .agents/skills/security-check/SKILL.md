---
name: security-check
description: Run all Jarvis security tools (gosec, govulncheck, golangci-lint, pnpm audit) and the new-code security checklist. Use for a security audit, before a release, or after larger changes.
---

# Jarvis — Security Check

On-demand security review, runnable manually — before a release or after
larger changes. The user-facing description of the application's security
measures is `docs/security.md`; this file is the agent-facing tooling
reference and checklist for what no tool enforces.

## Run Tools

```bash
cd backend
gosec ./...             # hardcoded credentials, SQL injection, path traversal, weak crypto
govulncheck ./...       # dependencies against the Go Vulnerability DB (CI only in the hook flow)
golangci-lint run       # linter suite incl. gosec, errcheck, bodyclose, noctx (.golangci.yml)
go mod verify           # module checksums against go.sum
go test -race ./...     # data races
make fuzz-backend       # native fuzzing, FUZZTIME=30s per target; crash inputs land in
                        # internal/<pkg>/testdata/fuzz/ and run as seeds in every `go test`
cd ../frontend && pnpm audit

make scan | scan-history | scan-staged | scan-all   # gitleaks (.gitleaks.toml, via podman)
make security-all       # gosec + govulncheck + pnpm audit
```

Automation split: the pre-commit hook runs Go tests, golangci-lint, pnpm audit
and gitleaks; **govulncheck runs only in CI** (its result depends on the
vulnerability DB, not on staged changes). Never use `--no-verify`.

## Checklist for new code

`gosec`, `errcheck`, `bodyclose`, `noctx` and `no-console` already enforce
hardcoded secrets, unchecked errors, unclosed bodies, HTTP calls without a
context and SQL string building. Left for review:

- Error responses never leak internal details (`c.JSON(500, "internal error")`).
- Fingerprint parameters are validated (`[a-f0-9]{16}`); pagination has
  `limit` ≤ 100 and `offset` ≥ 0.
- Frontend: no `dangerouslySetInnerHTML`, no `eval()`, `target="_blank"` links
  carry `rel="noopener noreferrer"` (none of these is lint-enforced).
- `.env` is not committed; `.env.example` holds placeholders only.
- `JARVIS_ALLOWED_ORIGINS` is set without a wildcard; `JARVIS_DB_DSN` points to
  a persistent volume or real DB host and is never logged raw
  (`db.RedactDSN()`).
- Container: the `Containerfile` stays distroless with `USER nonroot:nonroot`;
  `compose.yml` keeps `no-new-privileges`, `cap_drop: ALL`, `read_only: true`
  with a `tmpfs` for `/tmp`.

## Metrics endpoint

`GET /metrics` is intentionally public: it is registered outside the protected
`apiV1` group in `internal/api/router.go` and bypasses `full_protect`, like
`/health`. It leaks only aggregate counts and configured cluster names, never
alertnames, labels or annotations. If that trade-off is unacceptable for a
deployment, the mitigation is network policy / ingress rules, not app auth.

## Debug/pprof server

`internal/debugserver` (`heap`/`allocs`/`goroutine` only) is opt-in: no port
opens unless `JARVIS_PPROF_ADDR` is set, and `debugserver.New` rejects anything
but a literal loopback IP plus port at startup. Decision to keep: never add a
Kubernetes Service, Ingress or container port for it — access is
`kubectl port-forward` to a specific pod. Operator usage:
`docs/troubleshooting.md#memory-profiling-jarvis_pprof_addr`.

## CORS and WebSocket origin

The `Origin` header is validated for both HTTP CORS and the WebSocket upgrade
against `cfg.AllowedOrigins` (Critical Invariant #11). Never use an
unconditional `return true` in `upgrader.CheckOrigin` (`internal/ws/hub.go`):
today a missing `Origin` (non-browser client) is allowed, an empty allow-list
means same-origin only, otherwise the allow-list decides.

Because a missing `Origin` passes, the origin check alone does not gate
non-browser clients. In `full_protect` mode `/ws` is therefore also wrapped in
`auth.RequireAuth` (`internal/api/router.go`) — it streams the full alert
snapshot plus claim and comment events. The session cookie rides on the upgrade
request, so no WS-specific auth exists.
