---
name: pr-workflow
description: Branch, commit, pull-request, CI and merge workflow for every Jarvis change, with its three user gates (branch, PR, merge) and the changelog rules a PR must satisfy (PR title, BREAKING CHANGE footer, chart changelog entry). Use when starting a change, committing, pushing, opening or merging a PR, or fixing failing CI.
---

# Jarvis — Pull Request Workflow

`main` is PR-only (root `AGENTS.md` → Workflow Rules #10). The GitHub ruleset
`protect-main` has no bypass actors: direct pushes to `main` are rejected for
everyone, including admins. This applies to AI-driven changes and the release
prep commit alike (`.agents/skills/release/SKILL.md`).

---

## Steps and gates

The mandatory workflow for **every** code change (bug fix, feature, refactor,
docs) has three interactive gates — **ask, don't assume**:

1. **Branch gate — ask before starting new work.** When the user asks for
   a new change, before writing code or committing, ask whether to create
   a feature branch and propose a name (`git switch -c <type>/<slug>`,
   e.g. `feat/silence-templates`, `fix/ws-reconnect`). On yes: start from
   an up-to-date `main` (`git switch main && git pull --ff-only`), then
   create the branch. **Never commit on local `main`.** If you already
   committed on `main` by mistake, recover: create the branch at the
   current commit, then `git reset --hard origin/main` on `main` — the
   commit is preserved on the branch, nothing is lost.
2. Commit on the branch (`git commit -s`, tests in the same commit; run
   the done-gate checks from `AGENTS.md` → Workflow Rules #7 first).
3. **PR gate — ask before pushing.** When the user signals the change is
   done and wants to push, ask whether to open a PR directly via `gh`. On
   yes: `git push -u origin <branch>` and `gh pr create --base main`
   with a Conventional Commit title (see [Changelog rules](#changelog-rules))
   + filled-in body. If the change resolves a GitHub issue, the body must
   contain a closing keyword (`Closes #<nr>`, one per issue) — only that
   links the PR under the issue's "Development" section and closes the
   issue on merge; a plain "issue #<nr>" mention does neither. Report the
   branch name and PR URL to the user.
4. **Watch the CI pipeline and fix failures directly.** After opening the
   PR, watch its checks (`gh pr checks <pr> --watch --fail-fast`, or
   `gh run watch`). If a check fails: pull the failing job's logs
   (`gh run view --log-failed`), fix the cause on the branch, commit
   (`-s`), push, and re-watch. Repeat until all required checks are green.
5. **Merge gate — only on explicit user go-ahead.** With green CI, ask
   whether to merge (`required_approving_review_count` is 0, so self-merge
   works). On yes: `gh pr merge --squash --delete-branch`. Never merge on
   the user's behalf without an explicit request.
6. **Cleanup after merge.** Once the PR is merged: `git switch main`,
   `git pull --ff-only`, and delete the now-merged local branch
   (`git branch -d <branch>`). This leaves the user back on an up-to-date
   `main` with no stale branches, so no unrelated follow-up work lands on
   a merged branch.

---

## Changelog rules

Breaking changes are always stated explicitly — app and Helm chart
(`AGENTS.md` → Workflow Rules #13). Every version section of `CHANGELOG.md`
(app) and `charts/jarvis/CHANGELOG.md` (chart), and every release-notes file,
has a **Breaking Changes** section. When there are none it says so ("No
breaking changes.") — the section is never omitted, so its absence can never
be mistaken for "none". Concretely:

- **App**: the root `CHANGELOG.md` is **generated at release time only**
  (git-chglog from the commits) — never edit it by hand in a feature PR
  and never add an `Unreleased` section there (the release step prepends
  the generated section, a manual one ends up duplicated/orphaned). The
  squash commit subject becomes the changelog line — the repo's squash
  title setting is `PR_TITLE`, so the **PR title** is the changelog line:
  make it a meaningful, user-understandable Conventional Commit. A breaking
  change (removed/renamed env var or config, changed API/WS contract,
  required manual migration) needs a `BREAKING CHANGE: <what + migration>`
  footer at the start of a line in the squash commit message (the squash
  message setting is `COMMIT_MESSAGES`, so a footer in any branch commit
  body carries over). git-chglog renders only that footer into the Breaking
  Changes section — a `feat!:` subject alone is not enough. This asymmetry
  with the chart is deliberate: commits are the app's changelog source
  (Dependabot PRs, no merge conflicts); the chart has no own tags and its
  changes hide in `fix(db)`/`feat(config)` commits.
- **Chart**: every change under `charts/jarvis/` (except `tests/`) adds an
  entry under `## [Unreleased]` in `charts/jarvis/CHANGELOG.md` **in the
  same commit**, including its breaking-change classification. Breaking
  for the chart = anything that can make `helm install`/`upgrade` fail or
  change an existing release without a values change (removed/renamed
  values, changed defaults, new validations rejecting previously accepted
  values, new resources needing extra permissions, selector changes). A
  breaking chart change bumps the chart's major version at release.
- Enforced by `scripts/check-changelogs.sh` (pre-commit hook + CI `Helm`
  job). Format, templates and release-time steps →
  `.agents/skills/release/SKILL.md`.
