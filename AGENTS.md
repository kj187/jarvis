# AGENTS.md — Jarvis

You are a developer working on Jarvis, a web frontend for Prometheus
Alertmanager. This file is the **single entry point for every AI coding
agent**, whichever tool runs it, and contains the minimum context needed for
any task. Deep references live in `.agents/`, step-by-step workflows as
skills in `.agents/skills/` — load them on demand via the
[Task Router](#task-router--load-on-demand) below. Never duplicate content
from those files here or elsewhere; reference it instead.

## What Jarvis Is

Jarvis polls all configured Alertmanager clusters, stores every alert
lifecycle in SQLite or PostgreSQL, keeps the current poll snapshot in an
in-memory store, and pushes updates via WebSocket to the frontend. Users can
view, filter, silence, claim, and comment on alerts.

| Layer | Stack |
|---|---|
| Backend | Go 1.26+ · Echo v4 · module `github.com/kj187/jarvis/backend` |
| Frontend | React 19 · TypeScript (`strict`) · Vite 8 · Zustand v5 · TanStack Query v5 · Tailwind v4 |
| Database | SQLite (`modernc.org/sqlite`) or PostgreSQL (`pgx/v5`) — selected by `JARVIS_DB_DSN` prefix, both pure Go (no CGO) |
| Image | Single container: frontend embedded into the Go binary at build time (`//go:build prod` + `embed.FS`), distroless base |

Repository layout:

- `backend/` — Go backend (`internal/api`, `internal/history`, `internal/alertmanager`, `internal/auth`, `internal/ws`, …)
- `frontend/` — React app (`src/components`, `src/hooks`, `src/lib`, `src/store`, `e2e/`)
- `charts/jarvis/` — Helm chart (+ helm-unittest tests under `tests/`, own `CHANGELOG.md`)
- `docs/` — user-facing documentation (not AI context, except `docs/testing-e2e.md`, `docs/scope.md` and `docs/ai-agents.md`)
- `website/` — VitePress documentation site; renders the repo's own markdown, deployed to GitHub Pages
- `scripts/` — E2E runner, mock-OIDC config, manual test-alert/silence fixtures
- `.agents/` — AI reference files (`architecture.md`, `testing.md`, `lessons.md`) and `skills/` — workflows as [Agent Skills](https://agentskills.io), one `<name>/SKILL.md` each (routed below)
- `Makefile` — canonical entry for dev stack, demo stack, tests, security scans, fixtures (`make help`)

## Task Router — load on demand

Load the referenced file **before** starting the matching task. Do not guess
details that these files own. Entries under `.agents/skills/` are skills —
tools that support Agent Skills also offer them by name; reading the
`SKILL.md` directly is equivalent. All of this is tool-neutral — tool
adapters and their rules live in `docs/ai-agents.md`.

| Task | Load |
|---|---|
| Data model, DB schema, API endpoints, component tree, stores, WS events, auth, config env vars, alert state machine, technology decisions | `.agents/architecture.md` |
| Adding a feature: new endpoint, new component, new WS event, new cluster parameter (TDD checklist) | `.agents/skills/add-feature/SKILL.md` |
| Branching, committing, opening/merging a PR, fixing CI, changelog entries | `.agents/skills/pr-workflow/SKILL.md` |
| Judging whether a feature idea fits the project scope (scope gate) | `docs/scope.md` |
| Triaging a GitHub feature-request issue against the scope, drafting a reply | `.agents/skills/scope-triage/SKILL.md` |
| Writing or running tests, test matrix, test utilities, CI pipeline | `.agents/testing.md` |
| E2E / screenshot stack: Playwright specs, fixtures, auth modes, `compose.e2e.yml` | `docs/testing-e2e.md` |
| Documentation website (VitePress in `website/`, GitHub Pages), adding a doc page to the site | `.agents/skills/website/SKILL.md` |
| Database backends, multi-replica HA (leader election, snapshot distribution, WS fanout, failover) | `docs/postgres-ha.md` |
| Kubernetes deployment, SQLite → PostgreSQL migration | `docs/deploy-kubernetes.md`, `docs/migrate-postgres.md`, `docs/sqlite-limits.md` |
| Cutting a release — **only when the user explicitly asks** | `.agents/skills/release/SKILL.md` |
| Release demo video (YouTube), release-notes video block — **only on request** (asked upfront in Phase 0 of the release skill) | `.agents/skills/release-video/SKILL.md` |
| Security audit, new-code security checklist, security tooling | `.agents/skills/security-check/SKILL.md` |
| Debugging surprising behavior — check before re-deriving a known gotcha | `.agents/lessons.md` |
| Tool adapters, agent-context check | `docs/ai-agents.md` |

## Critical Invariants — NEVER break

1. **Grace Period (`max(60s, 2×JARVIS_POLL_INTERVAL)`)**: Alert seen again
   within the grace period after `resolved` → reopen old event, create **no**
   new one — prevents ghost-resolve entries on poll misses. Set via
   `Store.SetGracePeriod` (`cmd/jarvis/main.go`, derived from
   `cfg.PollInterval`, so a missed poll is absorbed even at intervals ≥ 60s).
   `Recorder.claimReleaseDelay` (also derived in `main.go`) must exceed it, or a
   claim is released before
   a re-fire can reopen the event (`.agents/lessons.md`).
2. **Increment `occurrence_count` only on second firing**: Not on the very
   first occurrence — only when `hadPreviousEvent = true`.
3. **`getEffectiveAlertState`**: Alert `suppressed` + **all** covering active
   silences (`status.silencedBy` can hold several) expire within ≤15 min →
   returns `active`; a single longer-running silence keeps it suppressed. This
   logic **only** in `lib/alertUtils.ts` — never duplicate.
4. **Filter functions stay centralized, never in components**: live-browser
   filtering remains exclusively in `lib/alertUtils.ts`
   (`getFilterableLabels`, `matchesLabelMatchers`, `matchesAlertSearch`,
   `safeRegex`). The only separate implementation is the persistent Resolved
   page's server-side `internal/alertfilter` package: it deliberately uses Go
   RE2 and per-label search, and shares the committed cross-language
   conformance fixture checked by `scripts/check-agent-context.sh` — never
   copy either implementation into handlers or components.
5. **Route order in Echo router**: `/api/v1/alerts/groups` must be registered
   **before** `/api/v1/alerts/:fingerprint/*`, otherwise `groups` is
   interpreted as a fingerprint. General rule: static segments before
   wildcard parameters.
6. **No `console.log` in production code** (not caught by `golangci-lint` —
   check manually).
7. **`cursor: pointer` on all clickable elements** — globally in CSS:
   `a, button, [role="button"] { cursor: pointer }`.
8. **SQLite single writer**: `SetMaxOpenConns(1)` + WAL mode — SQLite only.
   PostgreSQL uses a **capped** pool (`JARVIS_DB_MAX_OPEN_CONNS`, default 10,
   MaxIdle = MaxOpen) — never unbounded (it exhausted RDS connection slots in
   production) and never `SetMaxOpenConns(1)`.
9. **`JARVIS_DB_DSN` never logged raw**: `db.RedactDSN()` must wrap the DSN
   before any log call. Password stays out of logs.
10. **`rebind()` in `history/store.go`**: All SQL queries use `?`
    placeholders — `rebind()` converts them to `$N` for PostgreSQL at call
    time. Never write `$1` literals directly in query strings.
11. **CORS/WS Origin**: No wildcard `*`. `JARVIS_ALLOWED_ORIGINS` is used as
    allow-list for both HTTP CORS and the WebSocket upgrade.
12. **Silence-matching semantics must mirror Alertmanager, not UI-filter
    semantics**: whether a silence *covers* an alert (affected-alerts preview,
    overlap detection, expired-silence lookup) is decided only by
    `silenceWouldMatchAlert` / `silenceMatchesAlert` (`lib/alertUtils.ts`) —
    anchored regex (`anchoredRegex`, `^(?:pattern)$`, like Alertmanager's
    RE2) against the alert's real labels only, no `@cluster`/`@receiver`/
    `receiver` pseudo-labels. `matchesLabelMatchers` (substring regex,
    pseudo-labels, comma-list receivers) is the deliberately lenient
    filter-bar function — never use it for silence coverage (mixing
    them showed "0 affected alerts" while Alertmanager silenced alerts;
    `.agents/lessons.md`).
13. **Client-facing read endpoints never call Alertmanager synchronously.**
    Reads are served from poll snapshots (`AlertStore`, `SilenceStore`,
    cached member up-state); only the recorder poll and explicit user
    mutations (silence create/delete) go upstream — otherwise AM load scales
    with open browser tabs (live proxying in `getSilences`/`getClusters`
    roughly doubled AM CPU in a real deployment; `.agents/lessons.md`).
14. **A failed cluster fetch must never trigger resolves.** Its last
    successful snapshot stays authoritative — for alerts
    (`Recorder.lastGoodAlerts`) as for silences (`SilenceStore` snapshots
    only on success). Otherwise `applyPollResults` diffs zero alerts as mass
    resolves: phantom `resolved` events, wrong `occurrence_count`, premature
    claim releases (`.agents/lessons.md`).
15. **History side effects and Alertmanager polling are leader-only on
    PostgreSQL** (`docs/postgres-ha.md`). Exactly one pod (advisory lock,
    `internal/leader`) polls and writes history:
    `RecordStatusChange`/`RecordResolvedForCluster`, occurrence counts, delayed claim releases, `reconcileStartupResolves`,
    external-silence events, retention sweeps (`history.Recorder.IsLeader()`,
    `retention.Sweeper.shouldSweep()`). Followers serve reads/API/WS from the
    leader's `poll_snapshots` (`internal/history/recorder_snapshot.go`), never
    from an own poll. On SQLite `StaticElector` is always leader — same code
    path, no gate.
16. **`RecordStatusChange` stays transactional and, on PostgreSQL,
    advisory-xact-locked per episode.** Read-last → grace-delete → insert →
    count-update runs in one `Store.withTx`; on PostgreSQL it first sets
    `lock_timeout = '10s'`, then takes
    `pg_advisory_xact_lock(hashtext(fingerprint || ':' || cluster_name))` —
    otherwise concurrent pods insert duplicate event rows (SQLite is already
    serialized by `SetMaxOpenConns(1)`). `withTx` also caps every history
    transaction at `txTimeout` (30s) regardless of the caller's context — a
    peer stuck on the lock must never stall the sequential poll loop
    (`.agents/lessons.md`).
17. **`AlertStore.Get()` returns a deterministically ordered snapshot**:
    `startsAt` desc, then `fingerprint` asc, then `clusterName` asc
    (`internal/history/alert_store.go`) — a total order over unstable
    upstream order and the resolved-buffer map. `GET /api/v1/alerts`,
    `/api/v1/alerts/groups` and WS `alerts_update` pass it straight through
    and the frontend keeps incoming order, so an unsorted read path makes
    rows flicker on every poll (`.agents/lessons.md`). Never re-introduce an
    unsorted alert-list read path.
18. **Every pod's in-memory `AlertStore` must reflect a claim the instant it
    is broadcast — not just the originating pod's.** `claims.go` patches its
    own `AlertStore` (`SetActiveClaim`/`ClearActiveClaim`) and fans
    `claim_set`/`claim_released` out; receiving pods (`HandleFanoutMessage` /
    `HandleFanoutRef` → `applyClaimSideEffect`, `internal/api/fanout_dispatch.go`) must apply the **same** patch, not only
    re-broadcast. The post-mutation refetch of `GET /api/v1/alerts` lands on
    any pod (invariant #13), so a pod without the patch makes the claim
    flicker out and back (`.agents/lessons.md`). PostgreSQL multi-replica
    only; the patch is unconditional (NoopFanout never delivers).
19. **Label display configuration is display-only.** `labelDisplay.order`
    (pinned) / `labelDisplay.hidden` and `labelColors` (`useSettingsStore`)
    may only affect which chips `partitionLabelsForDisplay`
    (`lib/alertUtils.ts`) emits for card and list views — incl. the per-alert
    "+N" chip (`HiddenLabelsToggle`, `components/alerts/LabelChip.tsx`), whose
    reveal state is local and never writes back to settings — and how
    `labelColorStyle` paints them. They
    must never reach `getFilterableLabels`, `matchesLabelMatchers`,
    `silenceWouldMatchAlert`/`silenceMatchesAlert`, the affected-alerts
    preview, `findRelatedAlerts`, or the detail panel's Labels section — a
    hidden label is invisible, not absent (same bug class as #12).
20. **Settings migrations run before normalization drops unknown keys, and
    stay.** `normalizeSettings` (`lib/settingsUtils.ts`) keeps only known
    keys and validates the shape of every nested value (a `labelDisplay`
    missing `order`, for example, is dropped rather than kept partial), so a
    removed/renamed setting or a malformed value is silently gone unless its
    migration runs first: `migrateLegacyDefaultFilters` at the top of
    `normalizeSettings` itself, which both the server read path and
    `migratePersistedSettings`'s pre-v2 branch (zustand `persist` migrate —
    the localStorage path) call before `diffFromDefaults`, which only walks
    `DEFAULT_SETTINGS` keys and does no shape validation of its own. Never
    diff a raw persisted blob directly — always through `normalizeSettings`
    first, or a malformed nested field survives into `overrides` and crashes
    whatever reads it unconditionally (`partitionLabelsForDisplay`'s
    `config.order.indexOf(...)` on a `labelDisplay` without `order`,
    `.agents/lessons.md`). Server rows are never rewritten, so a legacy-key
    migration stays while rows from older releases may exist.
21. **Globally mounted browser hooks never load unbounded database history
    merely to compute a count.** When needed, history counts are SQL
    aggregates; history lists are paginated or streamed, and request
    cancellation propagates to the database.
22. **Every live resolved-buffer entry expires with its own episode after 20
    minutes on leaders and followers.** Re-ingesting the same episode never
    extends its deadline; a genuine re-fire/new resolve gets a new deadline.
    The central sweep removes follower-cache references too, but never active
    last-good alerts or persistent database history.

## Workflow Rules — always follow

1. **TDD**: Write the failing test first. Implementation + tests always in
   the **same commit**.
2. **Type sync**: After any Go model change, mirror the type in
   `frontend/src/types/index.ts` (exact camelCase field names matching the
   JSON tags).
3. **Pre-commit hook** (`.githooks/pre-commit`) runs checks based on staged
   paths: Go tests + golangci-lint incl. gosec (backend), pnpm audit + eslint +
   jscpd (frontend, needs running dev container), helm lint/unittest (charts),
   the changelog check `scripts/check-changelogs.sh`, the agent-context check
   `scripts/check-agent-context.sh` and a gitleaks secret scan (always).
   **Never `--no-verify`.**
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
   | User-visible behavior: new/changed feature, UI, config surface | `docs/features.md` + the matching topic file under `docs/` — the website publishes `docs/` on every push to `main`, so this happens in the same PR |
   | New or changed environment variable | `docs/configuration.md` — the **only** place an env var gets its own table row (name / default / one-sentence meaning), with a stable per-variable anchor (`<a id="jarvis_..."></a>`). A topic page (`docs/authentication-user.md`, `docs/authentication-alertmanager.md`, `docs/retention.md`, …) links to the anchor and explains relationships/flows around it — never repeats the table |
   | Go model, DB schema/migration, API route, WS event, env var, store/state shape, component/hook/lib file, state machine | `.agents/architecture.md` |
   | Test files, test commands, CI workflows, pre-commit hook, Makefile targets | `.agents/testing.md` |
   | Website structure, theme or sync script; **new file under `docs/`** (needs a sync entry + sidebar link) | `.agents/skills/website/SKILL.md` |
   | Security tooling, checklists, auth/origin behavior | `.agents/skills/security-check/SKILL.md` |
   | Feature-workflow conventions (validation rules, type-sync, checklists) | `.agents/skills/add-feature/SKILL.md` |
   | Branch/PR/CI/merge workflow, changelog rules for PRs | `.agents/skills/pr-workflow/SKILL.md` |
   | Release process, workflows in `release.yml`, versioning, changelog/release-notes format, social media post rules | `.agents/skills/release/SKILL.md` |
   | Issue-triage workflow, reply guidelines | `.agents/skills/scope-triage/SKILL.md` |
   | Anything under `charts/jarvis/` except `tests/` (templates, values, `Chart.yaml`, chart README) | `charts/jarvis/CHANGELOG.md` → `## [Unreleased]` (rule 13) |
   | Scope definition, in/out-of-scope boundaries, litmus test | `docs/scope.md` |
   | Project description, invariants, workflow rules, commit format, repo layout, Task Router | `AGENTS.md` itself |
   | Tool adapter, `scripts/check-agent-context.sh` | `docs/ai-agents.md` |
   | E2E stack, specs, fixtures, auth modes | `docs/testing-e2e.md` |
   | Database backend behavior, multi-replica HA (leader election, snapshot distribution, WS fanout, failover) | `docs/postgres-ha.md` |
   | Kubernetes HA deployment | `docs/deploy-kubernetes.md` |
   | Hard-won debugging insight or non-obvious gotcha | `.agents/lessons.md` |
   | Who-talks-to-whom topology: upstream calls, stores, WS events, poll flow | `docs/diagrams/*.mmd` + re-render via `make diagrams` |

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
   Only when the user explicitly asks (e.g. "release 1.6.0", `release`
   skill): load `.agents/skills/release/SKILL.md` and run its flow
   end-to-end. It asks exactly **one** upfront question (produce a release
   video? — Phase 0, before preflight) and has exactly **one** stop: the
   review gate (release notes, app + chart version, breaking-change
   classification, drafted social posts, YouTube URL if a video was made —
   shown before anything is committed or pushed). After the user's go, no
   further confirmations. Chart-only releases (chart changes without a new
   app version) follow the same file, section "Chart-only Release".
9. **Dependabot** runs every Monday (Go deps, npm/pnpm grouped, GitHub
   Actions). Its PRs run through CI — green CI → merge, no manual
   intervention needed.
10. **`main` is PR-only — always work on a feature branch, with user gates.**
    Direct pushes to `main` are rejected for everyone (ruleset
    `protect-main`) — for AI-driven changes and the release prep commit
    alike. Every change goes branch → commit (`-s`, tests in the same commit)
    → PR → watch CI and fix failures → squash merge → cleanup, and you **ask
    the user** at three gates: before creating
    the branch (propose `<type>/<slug>`), before pushing/opening the PR, and
    before merging. Never commit on local `main`. Exact steps, CI-failure
    handling and cleanup → `.agents/skills/pr-workflow/SKILL.md`.
11. **Scope gate — check every new feature against `docs/scope.md` before
    building it.** Applies to user-requested and self-proposed features
    alike. If the feature is out of scope or borderline, say so and explain
    why (litmus test + the matching in/out-of-scope bullet) **before writing
    any code** — the user decides whether to proceed anyway. Never silently
    build an out-of-scope feature. Bug fixes, refactorings, and docs need no
    scope check.
12. **Diagrams — Mermaid, containerized, source + render committed together.**
    Where a picture genuinely clarifies (data flow, who-talks-to-whom,
    lifecycles — not trivial structures), add a Mermaid source under
    `docs/diagrams/<name>.mmd` and render it with `make diagrams` (runs
    mermaid-cli in a container, no local tooling) to
    `docs/assets/<name>.svg`. Embed the SVG in the docs. The `.mmd` source
    and the rendered SVG belong in the **same commit** — and when a change
    alters what an existing diagram shows (new upstream call, new store, new
    WS event), update and re-render it in that same commit, like every other
    doc-sync duty in rule 6.
13. **Breaking changes are always stated explicitly — app and Helm chart.**
    Every version section of `CHANGELOG.md`, `charts/jarvis/CHANGELOG.md` and
    every release-notes file has a **Breaking Changes** section ("No breaking
    changes." when none — never omitted). The root `CHANGELOG.md` is generated
    at release time: never edit it in a feature PR; the **PR title** becomes
    its line, and a breaking change needs a `BREAKING CHANGE:` footer. Every
    change under `charts/jarvis/` (except `tests/`) adds an `## [Unreleased]`
    entry to the chart changelog in the same commit. Details →
    `.agents/skills/pr-workflow/SKILL.md`; enforced by
    `scripts/check-changelogs.sh`.

## Commit Format — Conventional Commits

```
feat(<scope>): ...     → MINOR  |  fix(<scope>): ...     → PATCH
security(<scope>): ... → PATCH  |  BREAKING CHANGE: ...  → MAJOR (footer, see Workflow Rule 13)
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
