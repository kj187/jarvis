# AGENTS.md — Jarvis

You are a developer working on Jarvis, a web frontend for Prometheus
Alertmanager. This file is the **single entry point for every AI coding
agent**: the minimum context for any task. Deep references live in `.agents/`,
workflows as skills in `.agents/skills/` — load them via the
[Task Router](#task-router--load-on-demand); never duplicate them here.

## What Jarvis Is

Jarvis polls all configured Alertmanager clusters, stores every alert
lifecycle in SQLite or PostgreSQL, keeps the current poll snapshot in an
in-memory store, and pushes updates via WebSocket to the frontend. Users can
view, filter, silence, claim, and comment on alerts.

Stack: Go 1.26+ (Echo v4); React 19,
TypeScript `strict`, Vite 8, Zustand v5, TanStack Query v5, Tailwind v4; SQLite
(`modernc.org/sqlite`) or PostgreSQL (`pgx/v5`) by `JARVIS_DB_DSN` prefix, both
pure Go; one distroless image, frontend embedded (`//go:build prod`).

Layout: `backend/` (Go, `internal/*`) · `frontend/` (`src/components|hooks|lib|store`,
`e2e/`) · `charts/jarvis/` (Helm, own `CHANGELOG.md`) · `docs/` (user docs; also AI
context: `testing-e2e.md`, `scope.md`, `design-system.md`, `ai-agents.md`) ·
`website/` (VitePress, renders `docs/`) · `design/` · `scripts/` · `Makefile` ·
`.agents/` (indexes `architecture.md`, `testing.md`, `lessons.md`; `invariants.md`,
`doc-sync.md`; [Agent Skills](https://agentskills.io) in `skills/<name>/SKILL.md`).

## Task Router — load on demand

Load the file **before** the matching task; do not guess what it owns. Skills
may be read directly; an index names the topic file(s) to open. Adapters:
`docs/ai-agents.md`.

| Task | Load |
|---|---|
| Data model, DB schema, API, WS events, auth, state machine, component tree, stores | `.agents/architecture.md` (index → topic file) |
| Changing code an invariant governs, reviewing a diff, proposing an invariant | `.agents/invariants.md` |
| Finishing a change: which docs and context files to update (Rule 6) | `.agents/doc-sync.md` |
| Workflows: feature TDD checklist · branch/commit/PR/CI/changelog · UI changes · feature-request issues · docs site, new doc page · security audit | `.agents/skills/<name>/SKILL.md`: `add-feature` · `pr-workflow` · `design-system` (rules: `docs/design-system.md`) · `scope-triage` · `website` · `security-check` |
| Scope gate for a feature idea | `docs/scope.md` |
| Tests, test matrix, CI pipeline · E2E / screenshot stack | `.agents/testing.md` (index → `.agents/testing/`) · `docs/testing-e2e.md` |
| Env vars, metrics, PostgreSQL / multi-replica HA, Kubernetes, migration | `docs/configuration.md`, `docs/metrics.md`, `docs/postgres-ha.md`, `docs/deploy-kubernetes.md`, `docs/migrate-postgres.md`, `docs/sqlite-limits.md` |
| Release — **only when the user explicitly asks** | `.agents/skills/release/SKILL.md` |
| Release demo video — **only on request** | `.agents/skills/release-video/SKILL.md` |
| Debugging surprising behavior — search first | `.agents/lessons.md` (→ `.agents/lessons/`) |

## Critical Invariants — NEVER break

This list is the contract: **breaking any entry is a defect, whichever file you
are in.** Each entry is a rule plus its code anchor. **Before changing code an
entry governs, read its full text in `.agents/invariants.md`;** a reviewer
checks a diff against all of them. Numbers are permanent IDs — never renumber
or reuse one; retire in place (`docs/ai-agents.md`).

1. **Grace period `max(60s, 2×JARVIS_POLL_INTERVAL)`**: an alert seen again
   after `resolved` within it reopens the old event, creates no new one;
   `Recorder.claimReleaseDelay` must exceed it. `Store.SetGracePeriod`,
   `cmd/jarvis/main.go`, `internal/history`.
2. **`occurrence_count` only on the second firing** — only when
   `hadPreviousEvent = true`. `internal/history`.
3. **`getEffectiveAlertState`**: `suppressed` + *all* covering active silences
   expiring within ≤15 min → `active`. Lives only in `lib/alertUtils.ts`.
4. **Filter logic stays centralized**: live filtering only in
   `lib/alertUtils.ts`; the Resolved page's server side only in
   `internal/alertfilter` (RE2, shared conformance fixture). Never copy it
   into handlers or components.
5. **Echo route order**: static segments before wildcard params
   (`/api/v1/alerts/groups` before `/api/v1/alerts/:fingerprint/*`).
   `internal/api/router.go`.
6. *Retired* — `console.log` is rejected by ESLint `no-console`.
7. *Retired* — `cursor: pointer` is the global CSS rule in
   `frontend/src/index.css`; never override it per component.
8. **DB pools**: SQLite `SetMaxOpenConns(1)` + WAL. PostgreSQL a capped pool
   (`JARVIS_DB_MAX_OPEN_CONNS`, default 10, MaxIdle = MaxOpen) — never
   unbounded, never 1.
9. **`JARVIS_DB_DSN` never logged raw** — wrap it in `db.RedactDSN()` before
   any log call.
10. **`rebind()` in `history/store.go`**: SQL uses `?` placeholders only,
    never `$1` literals.
11. **CORS/WS Origin**: no wildcard `*`; `JARVIS_ALLOWED_ORIGINS` is the
    allow-list for both HTTP CORS and the WebSocket upgrade.
12. **Silence coverage mirrors Alertmanager, not the UI filter**: decided only
    by `silenceWouldMatchAlert` / `silenceMatchesAlert` (`lib/alertUtils.ts`,
    anchored regex, real labels only). Never use `matchesLabelMatchers` for it.
13. **Client-facing read endpoints never call Alertmanager synchronously** —
    they serve poll snapshots (`AlertStore`, `SilenceStore`); only the
    recorder poll and explicit user mutations go upstream.
14. **A failed cluster fetch never triggers resolves** — its last good
    snapshot stays authoritative (`Recorder.lastGoodAlerts`, `SilenceStore`).
15. **History side effects and Alertmanager polling are leader-only on
    PostgreSQL** (`Recorder.IsLeader()`, `Sweeper.shouldSweep()`,
    `internal/leader`); followers serve from `poll_snapshots`.
16. **`RecordStatusChange` stays transactional** (`Store.withTx`, 30s cap); on
    PostgreSQL `lock_timeout = '10s'`, then the per-episode advisory xact lock.
17. **`AlertStore.Get()` is deterministically ordered**: `startsAt` desc,
    `fingerprint` asc, `clusterName` asc (`internal/history/alert_store.go`).
    Never add an unsorted alert-list read path.
18. **Every pod's `AlertStore` applies a broadcast claim**, not only the
    originating one (`applyClaimSideEffect`, `internal/api/fanout_dispatch.go`).
19. **Label display config is display-only** (`labelDisplay`, `labelColors`):
    only `partitionLabelsForDisplay` / `labelColorStyle` may read it — never
    filtering, silence matching, `findRelatedAlerts` or the detail panel.
20. **Settings migrations run before normalization drops unknown keys**:
    always through `normalizeSettings` (`lib/settingsUtils.ts`), never diff a
    raw persisted blob; a legacy-key migration stays while old rows may exist.
21. **Globally mounted browser hooks never load unbounded DB history to compute
    a count** — SQL aggregates; history lists paginated or streamed;
    cancellation reaches the database.
22. **Every live resolved-buffer entry expires with its own episode after 20
    minutes** on leaders and followers; re-ingest never extends it; the sweep
    never touches active last-good alerts or persistent history.

## Workflow Rules — always follow

1. **TDD**: Write the failing test first. Implementation + tests always in
   the **same commit**.
2. **Type sync**: After any Go model change, mirror the type in
   `frontend/src/types/index.ts` (camelCase names matching the JSON tags).
3. **Pre-commit hook** (`.githooks/pre-commit`) runs checks by staged path
   (list: `.agents/testing.md`). **Never `--no-verify`.**
4. **Frontend checklist**: no `dangerouslySetInnerHTML` · import shared
   utils from `lib/alertUtils.ts`, never re-implement them in components ·
   handle loading and error states · colours and radii only through semantic tokens (`bg-critical-soft`,
   `text-muted-foreground`, `rounded-control`, …), never raw palette classes —
   `node scripts/check-design-drift.mjs` enforces it.
5. **Backend**: All outbound HTTP calls use `context.WithTimeout` (default
   10s). Error responses never leak internal details.
6. **Keep docs and AI context in sync.** When a file contradicts the code, the
   code wins — verify, then fix the file. Update in the **same commit**, unasked,
   when a change touches: Go models / DB schema, API routes, WS events, env
   vars, state machines, invariants, test or CI commands, workflow or release
   contracts, security behavior, or user-visible behavior (`docs/features.md`).
   No duty to describe every component or hook; update the component tree only
   for a structural change (new page, store, hook family). Before finishing,
   walk the table in `.agents/doc-sync.md`.
7. **Done-gate — never report work as complete untested.** Before presenting
   non-documentation work as finished, run the targeted tests for what you
   changed (`go test ./internal/<pkg>/...`; frontend additionally
   `pnpm build`); for larger changes `make test-all` or `make verify` (adds
   the PostgreSQL tests and an image smoke test — `.agents/testing.md`). If a
   check cannot run or fails for pre-existing reasons, say so with the
   command and output — never claim green.
8. **Releases**: Never trigger a release without an explicit user request;
   then load `.agents/skills/release/SKILL.md` and follow its flow (one
   upfront question, one review-gate stop; chart-only releases: same file).
9. **Dependabot** runs every Monday; its PRs run through CI — green CI →
   merge, no manual intervention needed.
10. **`main` is PR-only — always work on a feature branch, with user gates.**
    Direct pushes to `main` are rejected. Every
    change goes branch → commit (`-s`, tests in the same commit) → PR → watch
    CI → squash merge → cleanup, and you **ask the user** at three gates:
    before creating the branch (propose `<type>/<slug>`), before
    pushing/opening the PR, and before merging. Never commit on local `main`.
    Steps → `.agents/skills/pr-workflow/SKILL.md`.
11. **Scope gate — check every new feature (requested or self-proposed)
    against `docs/scope.md` before building it.** Out of scope or borderline →
    say so and why **before writing any code**; the user decides. Never
    silently build an out-of-scope feature. Bug fixes, refactorings and docs
    need no scope check.
12. **Diagrams**: a Mermaid source in `docs/diagrams/` and its rendered SVG
    (`make diagrams`) are committed together — `.agents/doc-sync.md`.
13. **Breaking changes are always stated explicitly — app and Helm chart.**
    Every changelog and release-notes version has a **Breaking Changes**
    section ("No breaking changes." when none). The root `CHANGELOG.md` is
    generated, never edited in a feature PR: the **PR title** becomes its line,
    a breaking change adds a `BREAKING CHANGE:` footer. Every change under
    `charts/jarvis/` except `tests/` adds a chart `## [Unreleased]` entry in
    the same commit (`scripts/check-changelogs.sh`, `pr-workflow` skill).

## Commit Format — Conventional Commits

```
feat(<scope>): ... → MINOR  |  fix / security(<scope>): ... → PATCH
BREAKING CHANGE: ... → MAJOR (footer, Workflow Rule 13)
test / refactor / docs / chore → no bump (tests always in the implementation's commit)
```

Scopes: `alerts` `silences` `claims` `comments` `ws` `api` `db` `config`
`frontend` `docker`

**DCO**: every commit is signed off (`git commit -s`); CI enforces it.

## Quick Commands

```bash
cp .env.example .env    # configure at least one cluster
make setup              # enable pre-commit hooks (once)
make up                 # dev stack: frontend :5173, backend :8080
cd backend && go test ./...
make test-all
make verify             # every CI gate + PostgreSQL tests + image smoke test
```
