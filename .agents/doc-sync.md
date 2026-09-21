# Keeping the AI context and docs in sync

The mapping behind `AGENTS.md` → Workflow Rules #6. Load it **before you finish
a change** and walk the table for what you touched. These files are navigation
aids, not ground truth: **when a file contradicts the code, the code wins —
verify against the code before building on a documented claim, and fix the file
in the same commit.**

## What the duty covers

Update in the same commit, without being asked, when a change touches:

- Go models, DB schema/migrations
- API routes, WS events
- environment variables
- state machines
- critical invariants
- test or CI commands
- workflow or release contracts
- security behavior
- user-visible behavior (`docs/features.md` and its topic page)

There is **no duty** to describe every single component or hook in
`frontend-tree.md` / `frontend-components.md` (under `.agents/architecture/`). Update the component tree only for a
structural change: a new page, a new store, a new hook family. A changed
prop, constant, default or timeout belongs to the code — do not copy it into
these files, and remove such a copied value when you find it.

## Table

| You changed … | Update |
|---|---|
| User-visible behavior: new/changed feature, UI, config surface | `docs/features.md` + the matching topic file under `docs/` — the website publishes `docs/` on every push to `main`, so this happens in the same PR |
| New or changed environment variable | `docs/configuration.md` only — the **only** place an env var gets its own table row (name / default / one-sentence meaning), with a stable per-variable anchor (`<a id="jarvis_..."></a>`). A topic page (`docs/authentication-user.md`, `docs/retention.md`, …) links to the anchor and explains relationships/flows around it — never repeats the table. Not repeated in `.agents/` |
| Go model, DB schema/migration | `.agents/architecture/data-model.md` |
| API route, WS event, auth behavior | `.agents/architecture/api.md` |
| Metric | `docs/metrics.md` |
| State machine, recorder/history, retention, leader election, snapshot distribution, WS fanout | `.agents/architecture/history-and-ha.md` (the design and operator view: `docs/postgres-ha.md`) |
| Store/state shape, localStorage key, URL param, silence UI state | `.agents/architecture/frontend-state.md` |
| New page, store or hook family (structural change only) | `.agents/architecture/frontend-tree.md` / `frontend-components.md` |
| Test commands, CI workflows, pre-commit hook, Makefile targets | `.agents/testing.md`; new test *helpers* or a per-package matrix change → `.agents/testing/backend.md` / `frontend.md` |
| Website structure, theme or sync script; **new file under `docs/`** (needs a `PAGES` entry in `website/scripts/pages.mjs` + sidebar link) | `.agents/skills/website/SKILL.md` |
| Security tooling, auth/origin behavior | `.agents/skills/security-check/SKILL.md` |
| Feature-workflow conventions (validation rules, type-sync, checklists) | `.agents/skills/add-feature/SKILL.md` |
| Branch/PR/CI/merge workflow, changelog rules for PRs | `.agents/skills/pr-workflow/SKILL.md` |
| Release process, workflows in `release.yml`, versioning, changelog/release-notes format, social media post rules | `.agents/skills/release/SKILL.md` |
| Issue-triage workflow, reply guidelines | `.agents/skills/scope-triage/SKILL.md` |
| Anything under `charts/jarvis/` except `tests/` (templates, values, `Chart.yaml`, chart README) | `charts/jarvis/CHANGELOG.md` → `## [Unreleased]` (Workflow Rules #13) |
| A colour token (app, docs site, video) | `design/tokens.json`, then `node scripts/design-tokens.mjs` — never edit the generated files (`frontend/src/generated/tokens.css`, `website/.vitepress/theme/generated-tokens.css`, `frontend/e2e/video/generated-theme.ts`) |
| Logo or other brand asset | `design/assets/` (edit the master, then run `python3 scripts/logo-assets.py`; never edit derived files) |
| Scope definition, in/out-of-scope boundaries, litmus test | `docs/scope.md` |
| Colour/typography/contrast/motion/overlay rules, logo and media guidelines, a token or visual decision | `docs/design-system.md` |
| Project description, invariants (short list), workflow rules, commit format, repo layout, Task Router | `AGENTS.md` itself |
| A critical invariant's full text or rationale | `.agents/invariants.md` (the short entry stays in `AGENTS.md`) |
| Tool adapter, `scripts/check-agent-context.sh` | `docs/ai-agents.md` |
| E2E stack, specs, fixtures, auth modes | `docs/testing-e2e.md` |
| Database backend behavior, multi-replica HA (leader election, snapshot distribution, WS fanout, failover) | `docs/postgres-ha.md` |
| Kubernetes HA deployment | `docs/deploy-kubernetes.md` |
| Hard-won debugging insight or non-obvious gotcha | the matching file under `.agents/lessons/` (the heading names the symptom); a new area also gets a row in `.agents/lessons.md` |
| Who-talks-to-whom topology: upstream calls, stores, WS events, poll flow | `docs/diagrams/*.mmd` + re-render via `make diagrams` |

## A new critical invariant

Proposed by the author in the same PR, accepted by the maintainer at the PR
gate: a short numbered entry in `AGENTS.md → Critical Invariants` (rule + code
anchor) and its full text as `### N.` in `.agents/invariants.md`. Numbers are
permanent IDs cited from code and docs: never renumber or reuse one; retire an
entry in place. Criteria → `docs/ai-agents.md`.

## Diagrams

Mermaid, source and render committed together: add `docs/diagrams/<name>.mmd`
and render it with `make diagrams` (mermaid-cli in a container) to
`docs/assets/<name>-light.svg` / `-dark.svg`; embed the SVG in the docs. Only
where a picture clarifies (data flow, who-talks-to-whom, lifecycles). When a
change alters what an existing diagram shows (new upstream call, store, WS
event), re-render it in the same commit.

## Before finishing

Ask: "would a fresh AI session still find correct information in these files?"
If not, fix them first.
