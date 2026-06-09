# Jarvis — Claude Code Reference

## Architecture Overview

Jarvis is a web frontend for Prometheus Alertmanager. The Go 1.24+ backend (Echo v4) polls all configured Alertmanager clusters, stores every alert lifecycle in SQLite, keeps the current poll snapshot in an in-memory store, and pushes updates via WebSocket to the React 19 / TypeScript / Vite 6 frontend. The Go module path is `github.com/kj187/jarvis/backend`.

## Technology Decisions

| Decision | Why |
|---|---|
| `modernc.org/sqlite` instead of `mattn/go-sqlite3` | Pure Go — no C compiler needed in container build (Podman/distroless) |
| No CGO | Container build with `CGO_ENABLED=0`, distroless final image has no C runtime |
| `//go:build prod` tag | `embed.FS` cannot compile a non-existent `dist/` directory — two files (prod/!prod) instead of one |
| TanStack Query WS patching | WS events patch the cache directly (`setQueryData`) — no extra refetch round-trip |
| Zustand v5 with `persist` | `viewMode` + `filters` persisted in localStorage, but URL params take precedence |

## Development Workflow — always follow

**Feature / bug fix:**
1. Write failing test first (TDD) — implementation + tests always in the **same commit**
2. After any Go model change → mirror type in `frontend/src/types/index.ts` (exact camelCase field names)
3. `go test ./...` must pass. Pre-commit hook runs automatically: gosec + govulncheck + golangci-lint. **Never `--no-verify`.**
4. Frontend checklist: `cursor: pointer` on all clickable elements · no `console.log` · no `dangerouslySetInnerHTML` · import shared utils from `lib/alertUtils.ts` (never re-implement in components)
5. New API endpoint: register `/api/v1/alerts/groups` **before** `/:fingerprint/*` in `router.go`

**Commits — Conventional Commits:**
```
feat(<scope>): ...     → MINOR  |  fix(<scope>): ...     → PATCH
security(<scope>): ... → PATCH  |  BREAKING CHANGE: ...  → MAJOR
test(<scope>): ...     → no bump (tests always in same commit as implementation)
```
Scopes: `alerts` `silences` `claims` `comments` `ws` `api` `db` `config` `frontend` `docker`

**Cutting a release — ONLY when user explicitly asks:**
Never trigger a release automatically. Only when the user says "release" or "create a release": load `/project:release` and follow the process step-by-step.

**Release Workflow (full):**
```
# Option A: work on main
git push                        → CI runs (tests, lint, security, build)

# Option B: feature branch → merge first, then release
git checkout -b feature/my-feature
git push && gh pr create        → CI runs on PR
# merge PR → back on main

# When ready to release (either way):
/project:release                → changelog, semver bump, create + push tag
git push --tags                 → triggers release.yml

# release.yml does automatically:
#   1. Build linux/amd64 + linux/arm64 Docker image (Containerfile, multi-stage)
#   2. Push → ghcr.io/kj187/jarvis:v1.2.3 + ghcr.io/kj187/jarvis:1.2 + :latest
#   3. Create GitHub Release (auto-generated release notes)
```

**Image structure:** Frontend is embedded into the Go binary at build time (`//go:build prod` + `embed.FS`). Single image, no separate frontend container.

**Dependabot** (`.github/dependabot.yml`) — runs automatically every Monday:
- `backend/go.mod` → Go dependencies (one PR per update)
- `frontend/package.json` → npm/pnpm packages (minor+patch grouped into one PR)
- `.github/workflows/` → GitHub Actions versions

Dependabot PRs run through CI. Green CI → merge, done. No manual intervention needed.

**Deep reference (self-invoke when needed — user does not need to type these):**

| Command | When to load |
|---|---|
| `/project:architecture` | Full data model, all API endpoints, component tree, state machine |
| `/project:add-feature` | Detailed TDD checklist for backend + frontend |
| `/project:security-check` | Security tool commands + new-code checklist |
| `/project:testing` | Full test matrix, utilities, CI pipeline |

## Critical Invariants — NEVER break

1. **Grace Period (60s)**: Alert seen again within 60s after `resolved` → reopen old event, create **no** new one. Prevents ghost-resolve entries on poll misses.
2. **Increment `occurrence_count` only on second firing**: Not on the very first occurrence — only when `hadPreviousEvent = true`.
3. **`getEffectiveAlertState`**: Alert `suppressed` + silence ≤15 min until expiry → returns `active`. This logic **only** in `lib/alertUtils.ts` — never duplicate.
4. **Filter functions exclusively in `lib/alertUtils.ts`**: `getFilterableLabels`, `matchesLabelMatchers`, `safeRegex` — no copy-paste into components.
5. **Route order in Echo router**: `/api/v1/alerts/groups` must be registered **before** `/api/v1/alerts/:fingerprint/*`, otherwise `groups` is interpreted as a fingerprint.
6. **No `console.log` in production code** (not caught by `golangci-lint` — check manually).
7. **`cursor: pointer` on all clickable elements** — globally in CSS: `a, button, [role="button"] { cursor: pointer }`.
8. **SQLite single writer**: `SetMaxOpenConns(1)` + WAL mode. Never open multiple writers.
9. **CORS/WS Origin**: No wildcard `*`. `JARVIS_ALLOWED_ORIGINS` is used as allow-list for both.

## Test Commands

```bash
# Backend
cd backend
go test ./...                    # All tests
go test -v -race ./...           # With race detector (CI standard)
go test -cover ./...             # With coverage
go test ./internal/history/...   # Single package

# Frontend
cd frontend
pnpm test                        # Vitest unit tests
pnpm test:coverage               # With coverage
pnpm test:e2e                    # Playwright E2E
```

## Security Tools

```bash
cd backend
gosec ./...          # Security scanner (hardcoded secrets, SQL injection, etc.)
govulncheck ./...    # CVE check against Go Vulnerability DB
golangci-lint run    # Linter suite (errcheck, bodyclose, noctx, staticcheck, ...)
go mod verify        # Verify module checksums

cd frontend
pnpm audit           # Check frontend deps for CVEs
```

All these tools also run automatically in the **pre-commit hook** (`.githooks/pre-commit`) and in **CI** (`.github/workflows/ci.yml`).

## Start Development

```bash
cp .env.example .env    # Edit .env, configure at least one cluster
git config core.hooksPath .githooks   # Enable pre-commit hooks (once after clone)
podman compose -f compose.dev.yml up
# Frontend: http://localhost:5173 (Vite HMR)
# Backend:  http://localhost:8080 (air auto-rebuild)
```

