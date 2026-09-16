---
name: release
description: Fully automated Jarvis release — preflight, changelogs, release notes, tag, push, CI monitoring. Use only when the user explicitly asks for a release; the target version (e.g. 1.6.0) comes from the user's request, otherwise it is derived from the commits.
---

# Jarvis — Creating a Release

Release flow with **one review gate**: ask about video upfront, run preflight,
prepare changelogs and release notes, optionally record the video, draft social
posts, then **stop once** at the review gate (step 13) to show everything
before anything is committed or pushed. After the user's go — no further stops.

**Breaking changes are always explicit** (AGENTS.md → Workflow Rules #13):
the app `CHANGELOG.md`, the chart `charts/jarvis/CHANGELOG.md` and the release
notes each carry a *Breaking Changes* section for every version — "No breaking
changes." when there are none, never omitted.

**Never trigger a release without an explicit user request.** Load and follow
this file only when the user explicitly asks for a release (root `AGENTS.md`
→ Workflow Rules #8). Once the user has asked, run the whole flow without
stopping for confirmations — except the single review gate in step 13.

---

## Input

The user provides the target version with the request (e.g. "release 1.6.0",
as skill argument or in prose). Accept `X.Y.Z` or `vX.Y.Z`; normalize to tag
`vX.Y.Z`. If **no** version is given, derive the bump from the commits since
the last tag (Conventional Commits → semver table below) and state the derived
version in the final report — do not ask.

The flow needs a local checkout with an authenticated `gh` that may push
branches and tags, merge PRs and watch workflow runs. A sandboxed or cloud
agent session without those rights cannot run it — stop and tell the user
instead of working around it.

---

## Step-by-Step

### Phase 0 — Video decision (before anything else)

Ask the user exactly once: **"Produce a release video for YouTube and LinkedIn? (yes / no)"**
No answer, "no", or anything non-affirmative means no video — proceed without it.
Record the decision; it drives two later steps (step 10a and step 13).

### Phase 1 — Preflight (abort on any failure, report why)

1. `git status --porcelain` — working tree must be clean.
2. `git branch --show-current` — must be `main`.
3. Version sanity: valid semver, strictly greater than
   `git describe --tags --abbrev=0`, tag `vX.Y.Z` does not exist yet
   (`git tag -l vX.Y.Z` and `git ls-remote --tags origin vX.Y.Z`).
4. HEAD is pushed and CI is green:
   ```bash
   git fetch origin && git status -sb   # must not be ahead/behind
   gh run list --commit "$(git rev-parse HEAD)" --json workflowName,conclusion
   ```
   All completed runs must have `conclusion: success`. If CI is still
   running, wait (`gh run watch`). If red, abort.
5. Local backend tests: `cd backend && go test ./...` — must be green.
6. **Classify breaking changes** (decides the version numbers below):
   - **App**: `git log $(git describe --tags --abbrev=0)..HEAD --grep='BREAKING CHANGE'`
     plus a read of the commits since the last tag (removed/renamed env vars
     or config, changed API/WS contract, required manual migration). A
     breaking app change requires a major `X.0.0` — if the requested version
     isn't one, abort and report why. A breaking change that is missing its
     `BREAKING CHANGE:` footer is still breaking: write it into the generated
     changelog section by hand (step 8).
   - **Chart**: read `## [Unreleased]` in `charts/jarvis/CHANGELOG.md`. Any
     entry under its *Breaking Changes* → the chart version bump is major.
     Cross-check against `git diff <prev-tag>..HEAD -- charts/jarvis/` — a
     chart change without an `[Unreleased]` entry is a bug; add the entry.

### Phase 2 — Prepare release commit (on a release branch — `main` is PR-only)

7. **Create the release branch** (direct pushes to `main` are rejected —
   ruleset `protect-main`, AGENTS.md → Workflow Rules #10):
   ```bash
   git checkout -b release/vX.Y.Z
   ```
8. **Generate the app CHANGELOG section and prepend it** (tag does not exist
   yet → `--next-tag`; the `vX.Y.Z` query renders only the new version, so
   hand edits to older sections survive):
   ```bash
   { git-chglog --next-tag vX.Y.Z vX.Y.Z; cat CHANGELOG.md; } > CHANGELOG.md.new
   mv CHANGELOG.md.new CHANGELOG.md
   ```
   The root `CHANGELOG.md` is only ever written here — feature PRs never touch
   it (no `Unreleased` section; `.agents/skills/pr-workflow/SKILL.md` →
   Changelog rules). If one exists anyway, fold it into the generated section
   and remove it.
   The template (`.chglog/CHANGELOG.tpl.md`) always renders `### Breaking
   Changes` first — the `BREAKING CHANGE:` footers, or "No breaking changes.".
   Edit that section by hand when step 6 found a breaking change without a
   footer. When only the chart has breaking changes, replace the line with:
   `No breaking changes in the app. The Helm chart <version> released
   alongside has breaking changes — see [charts/jarvis/CHANGELOG.md](charts/jarvis/CHANGELOG.md).`
9. **Release the chart CHANGELOG** (`charts/jarvis/CHANGELOG.md`):
   - Rename `## [Unreleased]` to `## [<chart version>] - YYYY-MM-DD` and add a
     fresh, empty `## [Unreleased]` above it (no subsections — the next chart
     change adds them).
   - Add the bullet ``- `appVersion` bumped to `X.Y.Z`.`` under
     `### Changed` (create the subsection if needed).
   - No `[Unreleased]` content (appVersion-only release)? The new section is
     `### Breaking Changes` → `No breaking changes.` + `### Changed` →
     appVersion bump.
   - Update the link references at the bottom: `[Unreleased]` compares
     `vX.Y.Z...HEAD`, the new version compares `vPREV...vX.Y.Z`.
   - Subsection order per version: Breaking Changes (always first, never
     empty) → Added → Changed → Deprecated → Removed → Fixed → Security.
10. **Write curated release notes** to `.github/release-notes/vX.Y.Z.md`.
   The release workflow uses this file as the release body and **appends**
   the artifact sections itself (image digest, cosign/attestation verify,
   Helm install, SBOM) — do **not** include those in the notes file.
   - `vX.0.0` (first or new major) → Template A below
   - otherwise → Template B below
10a. **Video & social posts** (video only if Phase 0 was yes; social posts
   always). Run this now — the release notes from step 10 give both their
   material:
   - If Phase 0 was yes: run `.agents/skills/release-video/SKILL.md` now. It
     hands back the video files, covers, and the YouTube title/description
     (also written to `youtube.txt` in `VIDEO_OUT`). Ask the user to upload
     the video to YouTube before the review gate, so its URL is ready there.
   - Draft the **social media posts** (see *Social media posts* below) for
     LinkedIn, X and Reddit. Use the release URL
     (`https://github.com/kj187/jarvis/releases/tag/vX.Y.Z` — deterministic,
     safe to reference before the release exists) and, only if a video was
     produced, the placeholder `<YOUTUBE_URL>` (resolved at the review
     gate). Write them to `~/Downloads/jarvis-X.Y.Z-social/` in addition to
     showing them in chat.
11. **Bump versions in README, the installation guide and the demo stack** — the image tag is
   the **app** version, the `helm install --version` is the **chart** version
   (decoupled — never the app version, that chart doesn't exist). README and
   `docs/installation.md` carry both numbers, `docs/installation.md` also names the chart
   version in its cosign example, and `compose.demo.yml` pins the app image.
   Run before step 12 bumps `Chart.yaml`:
   ```bash
   PREV=$(git describe --tags --abbrev=0)
   PREV_CLEAN="${PREV#v}"
   PREV_CHART=$(awk '/^version:/{print $2}' charts/jarvis/Chart.yaml)
   # perl -pi instead of sed -i: identical on macOS (BSD sed) and Linux (GNU sed)
   for f in README.md docs/installation.md compose.demo.yml; do
     perl -pi -e "s|ghcr.io/kj187/jarvis:\Q${PREV_CLEAN}\E|ghcr.io/kj187/jarvis:X.Y.Z|g" "$f"
     perl -pi -e "s|--version \Q${PREV_CHART}\E |--version <chart version> |g" "$f"
     perl -pi -e "s|charts/jarvis:\Q${PREV_CHART}\E|charts/jarvis:<chart version>|g" "$f"
   done
   ```
   Verify every occurrence changed:
   ```bash
   grep -rn "ghcr.io/kj187/jarvis:\|--version \|charts/jarvis:" README.md docs/installation.md compose.demo.yml
   ```
12. **Bump chart versions** in `charts/jarvis/Chart.yaml` — chart version is
    **decoupled** from the app version, but an app release must ship a chart
    that deploys it:
    - `appVersion`: new app version (`"X.Y.Z"`, quoted)
    - `version`: semver by the impact of the chart changes in the released
      `[Unreleased]` section — any breaking change → **major**, new
      values/resources → minor, fixes or appVersion-only → patch. Must match
      the version used in step 9.
13. **Review gate — stop and show, wait for the user's go.** Nothing is
    committed or pushed yet. Show in the chat:
    - app version and chart version (with the reason for the chart bump),
    - the breaking-change classification from step 6 (app + chart),
    - the complete release notes (`.github/release-notes/vX.Y.Z.md`),
    - the new chart CHANGELOG section,
    - what was deliberately left out of the notes (and why),
    - the drafted **social media posts** (LinkedIn, X, Reddit) from step 10a.

    If Phase 0 was yes, ask for the **YouTube URL** now (the video was
    already produced in step 10a) and fill it into the *Watch the
    highlights* block and every `<YOUTUBE_URL>` placeholder in the social
    posts; show the notes again. The LinkedIn post's own URL is a separate,
    later follow-up (see *Video block in the release notes* below) — it is
    essentially never known at this point, since the user posts it only
    after the release is public.

    Then wait. Requested changes → apply, show again. Only an explicit go
    continues with step 14; from there on, no further confirmations.
14. **Check and commit everything together** (signed off — the DCO check runs on the PR):
    ```bash
    printf '%s\n' CHANGELOG.md charts/jarvis/CHANGELOG.md .github/release-notes/vX.Y.Z.md \
      | scripts/check-changelogs.sh
    git add CHANGELOG.md README.md docs/installation.md compose.demo.yml charts/jarvis/Chart.yaml charts/jarvis/CHANGELOG.md .github/release-notes/vX.Y.Z.md
    git commit -s -m "chore(release): prepare vX.Y.Z"
    ```

### Phase 3 — PR, merge, tag & push

15. **Push the branch and open the PR**:
    ```bash
    git push -u origin release/vX.Y.Z
    gh pr create --title "chore(release): prepare vX.Y.Z" \
      --body "Release preparation for vX.Y.Z (app + chart changelog, release notes, README, chart bump)."
    ```
16. **Wait for all required checks, then merge** (merge commit, not squash —
    keeps the signed-off prep commit intact) and update local `main`:
    ```bash
    gh pr checks release/vX.Y.Z --watch --fail-fast
    gh pr merge release/vX.Y.Z --merge --delete-branch
    git checkout main && git pull origin main
    ```
17. **Create the annotated tag on the merge commit and push it**. The merge
    to `main` triggers `chart-release.yml` (`charts/**` changed), but that run
    **skips** publishing: the image for the new `appVersion` doesn't exist
    yet (notice in the run summary — expected, not a failure). The tag push
    triggers `release.yml`, which builds the image first and only then
    publishes the chart and creates the GitHub Release:
    ```bash
    git tag -a vX.Y.Z -m "Release vX.Y.Z"
    git push origin vX.Y.Z
    ```

### Phase 4 — Monitor & verify (done-gate)

18. Watch the release workflow to completion (jobs: Build & Push → Helm
    Chart → GitHub Release):
    ```bash
    gh run list --workflow=release.yml --limit 1
    gh run watch <run-id> --exit-status
    ```
19. Verify the release and the chart exist and report to the user:
    ```bash
    gh release view vX.Y.Z --json url,assets
    helm show chart oci://ghcr.io/kj187/charts/jarvis --version <chart version>
    ```
    Final report must include: release URL, image ref
    `ghcr.io/kj187/jarvis:X.Y.Z`, chart version (flag it if it is a new
    major with breaking changes), and whether `sbom.spdx.json` and
    `sbom.spdx.json.sigstore.json` are attached. If any workflow failed, report the failing step and log
    excerpt — never claim success.

---

## Release-Notes Templates

Write the notes file in English, derived from the CHANGELOG section and the
actual commits (read them — don't just reformat commit subjects). No
artifact/verify sections — the workflow appends those.

**Do not hard-wrap prose.** One paragraph or bullet = one physical line, no
matter how long. GitHub reflows release bodies to the reader's viewport;
manual line breaks (or a fixed ~72/80-column fill) render as a cramped,
ragged narrow column on the release page. This applies to the blurb,
`### Added`/`### Fixed`/… bullets, and every other line of prose in the file.

**Breaking Changes section — mandatory in both templates, never omitted.** It
always has exactly two bullets, one for the app and one for the Helm chart
released alongside, each either "No breaking changes." or the concrete break
plus its migration (what fails, what to change). Source: step 6 — app from
the commits/footers, chart from the released `[Unreleased]` section of
`charts/jarvis/CHANGELOG.md`. Place it right after the theme sentence so
nobody upgrades past it.

**Screenshots for headline features (optional, 2–3 max).** Reuse the
element-cropped doc screenshots in `docs/assets/` (regenerated by the E2E
screenshot stack) — no new image files. Relative paths don't resolve in a
release body, so reference them by raw URL pinned to the release tag, which
exists by the time the release is created:
`<img src="https://raw.githubusercontent.com/kj187/jarvis/vX.Y.Z/docs/assets/<file>.png" alt="…" width="…">`,
appended to the feature's bullet after `<br><br>` (same physical line), with a
`width` that keeps it compact (≤ 720, never above the PNG's pixel width).

**Release video (optional, only when the user said yes at Phase 0).**
The *Watch the highlights* block — YouTube thumbnail linked to the video —
goes directly after *Breaking Changes*; format in
`.agents/skills/release-video/SKILL.md`. The YouTube URL is usually already
known by the review gate (step 10a produced the video ahead of time); a
LinkedIn mention in the same block almost never is — see that section for
the follow-up-edit path.

**Credit people who shaped a change.** When a feature or fix goes back to a
GitHub issue with a substantial proposal or report, link the issue in the
bullet and thank its author by handle (`Thanks to @user for the detailed
proposal in #123!`) — contributions are not only code. Phrase it as
"requested/proposed in", not "implements", when only part of the issue was
built.

**Template A — Initial / major release (v1.0.0, v2.0.0, …)**

```markdown
# 🎉 <Project Name> vX.0.0 — <headline>

<One punchy sentence: what this is and why it exists.>

## Breaking Changes

- **Jarvis:** <No breaking changes. | what breaks + migration>
- **Helm chart <chart version>:** <No breaking changes. | what breaks + migration>

---

## Why <Project Name>?

<2-3 sentence problem statement: what existing tools lack, what prompted this.>

- **<Feature>** — <one-line why it matters>
- *(mirror the "Why Jarvis?" section from README)*

---

## What's in this release

<Narrative paragraph — not a bullet dump. Highlight the 3-5 most important
capabilities and what makes them interesting.>

Full feature list → [README](https://github.com/kj187/jarvis#readme)

---

## Tech stack

<single line: languages, frameworks, key libs>

---

*Feedback and contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).*
```

**Template B — Regular patch / minor release**

```markdown
## What's changed

<One sentence summarising the theme of this release
(e.g. "Focus on stability and PostgreSQL reliability").>

### Breaking Changes
- **Jarvis:** <No breaking changes. | what breaks + migration>
- **Helm chart <chart version>:** <No breaking changes. | what breaks + migration>

### Added
- <item — user-facing phrasing, not commit subject>

### Fixed
- <item>

### Security
- <item>

### Changed
- <item — only if relevant to users; skip pure dep bumps>

**Full diff:** [vPREV...vNEW](https://github.com/kj187/jarvis/compare/vPREV...vNEW)
```

Omit empty sections — except *Breaking Changes*, which is always present.

---

## Social media posts

Drafted at step 10a, shown again at the review gate (step 13) — always as a
copy/paste block in chat **and** as files in
`~/Downloads/jarvis-X.Y.Z-social/` (`linkedin.txt`,
`linkedin-first-comment.txt`, `x.txt`, `reddit.md`). English, derived from
the same release notes as the GitHub release body.

**Style, every channel plus the YouTube text and release-notes prose above**
— avoid the AI-written tells: emojis LinkedIn ≤ 1–2 total, X ≤ 1, Reddit/
YouTube none, never an emoji list or ✅/🚀/🔥 chain; no "excited to
announce", "game-changer", "dive into", "seamless", "supercharge", "unlock",
"elevate"; no reflexive em-dash-per-sentence or rule-of-three lists; concrete
over promotional — what used to be annoying, what works now, not ad copy.

**LinkedIn.** Hook in the first two lines (the pain removed, not "excited to
announce"). 3–5 features, short title + one sentence each (share the 1–2
emoji budget above across the whole post, not one per feature). Fixes in one
line if substantial; breaking changes (app or chart) in one clear sentence.
Credit contributors by name. Close with a question + 3–5 hashtags
(#Prometheus #Alertmanager #SRE #OpenSource #Kubernetes). **No links in the
body** — release/repo/YouTube URLs go in the first comment
(`linkedin-first-comment.txt`). Hints for the user: upload the square video
natively with its cover, post Tue–Thu morning, answer comments early.

**X.** One post ≤ 280 chars (a link counts as 23 chars) with the release or
YouTube link, ≤ 2 hashtags. Optional thread of 3–5 posts, one feature each,
≤ 280 chars. Note for the user: without X Premium, native video caps at
2:20 — link YouTube instead, or cut a short clip.

**Reddit.** Factual title, no clickbait, no emoji. Markdown body: honest
maintainer disclosure ("I maintain Jarvis, a …"), 1–2 sentences on what it
is, new features as a short list, links (repo, release, video), invite
feedback. Suggest matching subreddits (r/PrometheusMonitoring, r/sre,
r/kubernetes, r/devops, r/selfhosted); remind the user to check each one's
self-promotion rules and not cross-post everywhere the same day.

---

## Version Scheme (Semver)

| Bump | When | Commit type |
|---|---|---|
| `PATCH` | Bug fix, security patch, small improvements | `fix:`, `security:` |
| `MINOR` | New feature, backwards-compatible | `feat:` |
| `MAJOR` | Breaking change (API, config format, DB schema migration required) | `BREAKING CHANGE:` footer |

The **Helm chart** is versioned separately with the same scheme, judged by
chart impact: breaking (see `.agents/skills/pr-workflow/SKILL.md` →
Changelog rules for the definition) → major, new values/resources → minor, fixes and appVersion-only
bumps → patch.

First stable release: `v1.0.0`. Before that: `v0.x.y` (no stability guarantee).

---

## Hotfix Release

Same flow — a release of `X.Y.(Z+1)` from `main` after the fix is merged. There
is no separate fast path: the notes file and CHANGELOG are cheap and keep the
release history consistent.

---

## Chart-only Release

For shipping chart changes (`[Unreleased]` entries in
`charts/jarvis/CHANGELOG.md`) **without** a new app version — e.g. an urgent
chart fix. Only when the user explicitly asks for it. No tag, no GitHub
Release, no app CHANGELOG, no release-notes file; `appVersion` stays.

1. Preflight as in Phase 1, steps 1–4 (clean `main`, in sync, CI green).
2. Branch: `git switch -c release/chart-<chart version>`.
3. Chart CHANGELOG as in step 9 — rename `[Unreleased]`, fresh empty
   `[Unreleased]` above — but **without** an appVersion bullet. There is no
   tag to compare against, so the new version's link reference points to
   the chart's commit history:
   `https://github.com/kj187/jarvis/commits/main/charts/jarvis`.
4. Bump `version` in `charts/jarvis/Chart.yaml` (breaking → major, …) and
   the README Getting Started `helm install --version` (step 11, chart part
   only).
5. Review gate as in step 13 (versions, breaking classification, the new
   chart CHANGELOG section). Wait for the go.
6. `scripts/check-changelogs.sh`, commit (`chore(release): chart <version>`,
   `-s`), push, PR, wait for checks, merge (`--merge`) — as in steps 14–16.
7. The merge triggers `chart-release.yml`: the image for the unchanged
   `appVersion` exists, so it publishes and signs the chart. Watch it
   (`gh run list --workflow=chart-release.yml --limit 1`, `gh run watch`),
   then verify with `helm show chart oci://ghcr.io/kj187/charts/jarvis
   --version <version>` and report.

---

## Release Candidates (Pre-releases)

Only on explicit request, for validating a batch of changes before a real
release: tag `vX.Y.Z-rc.N`, publish as a GitHub pre-release, no changelog
entry and no `latest` tag. The full flow is in
`.agents/skills/release/references/release-candidates.md`.

---

## What GitHub Actions does automatically (after tag push)

Background reference, not needed to run the flow — read
`.agents/skills/release/references/github-actions.md` when debugging a
failed release workflow run (step 18/19): the three jobs in
`release.yml` (`build-and-push` → `chart` → `release`: build, sign, SBOM,
GitHub Release) and the Helm chart workflow's existence/image guards.

---

## Prerequisites

- `git-chglog` **v0.15.4** (pinned — template/config behavior, e.g. `.RevertCommits`, is verified against it): `go install github.com/git-chglog/git-chglog/cmd/git-chglog@v0.15.4`
- `gh` CLI authenticated (used for CI checks, run watching, release verify)
- `.chglog/config.yml` must exist
- `GITHUB_TOKEN` in GitHub Actions secrets (injected automatically)
