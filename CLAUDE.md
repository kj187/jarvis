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

## Git Workflow

```bash
# Enable pre-commit hooks (once after git clone):
git config core.hooksPath .githooks

# Commit conventions (Conventional Commits):
# feat(<scope>): ...    → MINOR bump
# fix(<scope>): ...     → PATCH bump
# security(<scope>): .. → PATCH bump
# BREAKING CHANGE: ...  → MAJOR bump
```

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
podman compose -f compose.dev.yml up
# Frontend: http://localhost:5173 (Vite HMR)
# Backend:  http://localhost:8080 (air auto-rebuild)
```

## Further Reference (`.claude/commands/`)

| Command | When to use |
|---|---|
| `/project:architecture` | Full data model, API endpoints, component tree, state machine |
| `/project:add-feature` | TDD workflow + checklist for new features (backend + frontend) |
| `/project:security-check` | Run security tools manually + new code checklist |
| `/project:testing` | Test strategy, utilities, scenarios, coverage targets |
| `/project:release` | Full release process (changelog, tag, GHCR, GitHub Release) |
