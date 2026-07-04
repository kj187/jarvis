# AGENTS.md — Jarvis

You are a developer working on Jarvis, a web frontend for Prometheus
Alertmanager. This file is the **single entry point for every AI agent**
(Claude Code, GitHub Copilot, Codex, …) and contains the minimum context
needed for any task. Deep, task-specific references live in `.agents/` —
load them on demand via the [Task Router](#task-router--load-on-demand)
below. Never duplicate content from those files here or elsewhere; reference
it instead.

## What Jarvis Is

Jarvis polls all configured Alertmanager clusters, stores every alert
lifecycle in SQLite or PostgreSQL, keeps the current poll snapshot in an
in-memory store, and pushes updates via WebSocket to the frontend. Users can
view, filter, silence, claim, and comment on alerts.

| Layer | Stack |
|---|---|
| Backend | Go 1.25+ · Echo v4 · module `github.com/kj187/jarvis/backend` |
| Frontend | React 19 · TypeScript (`strict`) · Vite 8 · Zustand v5 · TanStack Query v5 · Tailwind v4 |
| Database | SQLite (`modernc.org/sqlite`) or PostgreSQL (`pgx/v5`) — selected by `JARVIS_DB_DSN` prefix, both pure Go (no CGO) |
| Image | Single container: frontend embedded into the Go binary at build time (`//go:build prod` + `embed.FS`), distroless base |

Repository layout:

- `backend/` — Go backend (`internal/api`, `internal/history`, `internal/alertmanager`, `internal/auth`, `internal/ws`, …)
- `frontend/` — React app (`src/components`, `src/hooks`, `src/lib`, `src/store`, `e2e/`)
- `charts/jarvis/` — Helm chart (+ helm-unittest tests under `tests/`)
- `docs/` — user-facing documentation (not AI context, except `docs/testing-e2e.md`)
- `scripts/` — E2E runner, mock-OIDC config, manual test-alert/silence fixtures
- `.agents/` — task-specific AI reference files (routed below)
- `Makefile` — canonical entry for dev stack, tests, security scans, fixtures (`make help`)

## Task Router — load on demand

Load the referenced file **before** starting the matching task. Do not guess
details that these files own.

| Task | Load |
|---|---|
| Data model, DB schema, API endpoints, component tree, stores, WS events, auth, config env vars, alert state machine, technology decisions | `.agents/architecture.md` |
| Adding a feature: new endpoint, new component, new WS event, new cluster parameter (TDD checklist) | `.agents/add-feature.md` |
| Writing or running tests, test matrix, test utilities, CI pipeline | `.agents/testing.md` |
| E2E / screenshot stack: Playwright specs, fixtures, auth modes, `compose.e2e.yml` | `docs/testing-e2e.md` |
| Cutting a release — **only when the user explicitly asks** | `.agents/release.md` |
| Security audit, new-code security checklist, security tooling | `.agents/security.md` |
| Debugging surprising behavior — check before re-deriving a known gotcha | `.agents/lessons.md` |

Tool-specific entry points map to the same files (no duplicated content):

- **Claude Code**: `CLAUDE.md` includes this file; `/project:architecture`,
  `/project:add-feature`, `/project:testing`, `/project:release`,
  `/project:security-check` include the corresponding `.agents/` file.
- **GitHub Copilot**: `.github/copilot-instructions.md` is a symlink to this file.
- **Codex**: reads `AGENTS.md` natively.

## Critical Invariants — NEVER break

1. **Grace Period (60s)**: Alert seen again within 60s after `resolved` →
   reopen old event, create **no** new one. Prevents ghost-resolve entries on
   poll misses.
2. **Increment `occurrence_count` only on second firing**: Not on the very
   first occurrence — only when `hadPreviousEvent = true`.
3. **`getEffectiveAlertState`**: Alert `suppressed` + silence ≤15 min until
   expiry → returns `active`. This logic **only** in `lib/alertUtils.ts` —
   never duplicate.
4. **Filter functions exclusively in `lib/alertUtils.ts`**:
   `getFilterableLabels`, `matchesLabelMatchers`, `safeRegex` — no copy-paste
   into components.
5. **Route order in Echo router**: `/api/v1/alerts/groups` must be registered
   **before** `/api/v1/alerts/:fingerprint/*`, otherwise `groups` is
   interpreted as a fingerprint. General rule: static segments before
   wildcard parameters.
6. **No `console.log` in production code** (not caught by `golangci-lint` —
   check manually).
7. **`cursor: pointer` on all clickable elements** — globally in CSS:
   `a, button, [role="button"] { cursor: pointer }`.
8. **SQLite single writer**: `SetMaxOpenConns(1)` + WAL mode — only for the
   SQLite dialect. PostgreSQL uses the default pool. Never add
   `SetMaxOpenConns(1)` for PostgreSQL.
9. **`JARVIS_DB_DSN` never logged raw**: `db.RedactDSN()` must wrap the DSN
   before any log call. Password stays out of logs.
10. **`rebind()` in `history/store.go`**: All SQL queries use `?`
    placeholders — `rebind()` converts them to `$N` for PostgreSQL at call
    time. Never write `$1` literals directly in query strings.
11. **CORS/WS Origin**: No wildcard `*`. `JARVIS_ALLOWED_ORIGINS` is used as
    allow-list for both HTTP CORS and the WebSocket upgrade.

## Workflow Rules — always follow

1. **TDD**: Write the failing test first. Implementation + tests always in
   the **same commit**.
2. **Type sync**: After any Go model change, mirror the type in
   `frontend/src/types/index.ts` (exact camelCase field names matching the
   JSON tags).
3. **Pre-commit hook** (`.githooks/pre-commit`) runs checks based on staged
   paths: Go tests + golangci-lint incl. gosec (backend), pnpm audit + eslint +
   jscpd (frontend, needs running dev container), helm lint/unittest (charts),
   and a gitleaks secret scan (always). **Never `--no-verify`.**
4. **Frontend checklist**: `cursor: pointer` on all clickable elements · no
   `console.log` · no `dangerouslySetInnerHTML` · import shared utils from
   `lib/alertUtils.ts` (never re-implement in components) · handle loading
   and error states.
5. **Backend**: All outbound HTTP calls use `context.WithTimeout` (default
   10s). Error responses never leak internal details.
6. **Keep the AI context files in sync — part of every change, not optional.**
   These files are navigation aids, not ground truth: **when a file contradicts
   the code, the code wins — verify against the code before building on a
   documented claim, and fix the file immediately.** Whenever a change touches
   something these files document, update the affected file **in the same
   commit** — without being asked. Do not wait for the user to remind you.
   Mapping:

   | You changed … | Update |
   |---|---|
   | Go model, DB schema/migration, API route, WS event, env var, store/state shape, component/hook/lib file, state machine | `.agents/architecture.md` |
   | Test files, test commands, CI workflows, pre-commit hook, Makefile targets | `.agents/testing.md` |
   | Security tooling, checklists, auth/origin behavior | `.agents/security.md` |
   | Feature-workflow conventions (validation rules, type-sync, checklists) | `.agents/add-feature.md` |
   | Release process, workflows in `release.yml`, versioning | `.agents/release.md` |
   | Project description, invariants, workflow rules, commit format, repo layout | `AGENTS.md` itself |
   | E2E stack, specs, fixtures, auth modes | `docs/testing-e2e.md` |
   | Hard-won debugging insight or non-obvious gotcha | `.agents/lessons.md` |

   A new **critical invariant** discovered during work goes into
   `AGENTS.md → Critical Invariants`. Before finishing any task, ask yourself:
   "would a fresh AI session still find correct information in these files?"
   If not, fix them first.
7. **Done-gate — never report work as complete untested.** Before presenting
   non-documentation work as finished: run the targeted tests for what you
   changed (`go test ./internal/<pkg>/...`; frontend changes additionally
   `pnpm build`). For larger or cross-cutting changes run `make test-all`.
   If a check cannot be run or fails for pre-existing reasons, say so
   explicitly with the command and output — do not claim green.
8. **Releases**: Never trigger a release without an explicit user request.
   Only when the user explicitly asks (e.g. `/release 1.6.0`): load
   `.agents/release.md` and run its flow end-to-end — it is fully
   non-interactive, do not stop for confirmations.
9. **Dependabot** runs every Monday (Go deps, npm/pnpm grouped, GitHub
   Actions). Its PRs run through CI — green CI → merge, no manual
   intervention needed.
10. **`main` is PR-only.** The GitHub ruleset `protect-main` has no bypass
    actors: direct pushes to `main` are rejected for everyone, including
    admins. Ship every change as branch → PR → all required status checks
    green → merge (`required_approving_review_count` is 0, so self-merge
    without approval works). This applies to AI-driven changes and the
    release prep commit alike (`.agents/release.md`).

## Commit Format — Conventional Commits

```
feat(<scope>): ...     → MINOR  |  fix(<scope>): ...     → PATCH
security(<scope>): ... → PATCH  |  BREAKING CHANGE: ...  → MAJOR
test(<scope>): ...     → no bump (tests always in same commit as implementation)
refactor / docs / chore → no bump
```

Scopes: `alerts` `silences` `claims` `comments` `ws` `api` `db` `config`
`frontend` `docker`

**DCO**: Every commit must be signed off (`git commit -s`, adds a
`Signed-off-by:` trailer) — enforced by the `DCO` check in CI on every PR.

## Quick Commands

```bash
# Development stack (hot-reload; Podman or Docker)
cp .env.example .env    # configure at least one cluster
make setup              # enable pre-commit hooks (once; = git config core.hooksPath .githooks)
make up                 # = podman compose -f compose.dev.yml up
# Frontend: http://localhost:5173 (Vite HMR) · Backend: http://localhost:8080 (air)

# Fast test feedback (full matrix and E2E commands → .agents/testing.md)
cd backend && go test ./...
make test-all
```
