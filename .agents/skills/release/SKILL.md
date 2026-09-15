---
name: release
description: Fully automated Jarvis release — preflight, changelogs, release notes, tag, push, CI monitoring. Use only when the user explicitly asks for a release; the target version (e.g. 1.6.0) comes from the user's request, otherwise it is derived from the commits.
---

# Jarvis — Creating a Release

Automated release with **one review gate**: a release request for `X.Y.Z`
(the `release` skill) runs preflight, changelogs (app + Helm chart), curated
release notes and version bumps, then **stops once** to show the user the release notes and versions (step 13).
After the user's go, the rest — commit, PR, merge, tag, push, CI monitoring —
runs without further questions.

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
11. **Bump versions in README** — the two occurrences in the Getting Started
   block. The image tag is the **app** version, the `helm install --version`
   is the **chart** version (decoupled — never the app version, that chart
   doesn't exist). Run before step 12 bumps `Chart.yaml`:
   ```bash
   PREV=$(git describe --tags --abbrev=0)
   PREV_CLEAN="${PREV#v}"
   PREV_CHART=$(awk '/^version:/{print $2}' charts/jarvis/Chart.yaml)
   # perl -pi instead of sed -i: identical on macOS (BSD sed) and Linux (GNU sed)
   perl -pi -e "s|ghcr.io/kj187/jarvis:\Q${PREV_CLEAN}\E|ghcr.io/kj187/jarvis:X.Y.Z|g" README.md
   perl -pi -e "s|--version \Q${PREV_CHART}\E |--version <chart version> |g" README.md
   ```
   Verify both occurrences changed (image tag + helm `--version`).
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
    - what was deliberately left out of the notes (and why).

    Then wait. Requested changes → apply, show again. Only an explicit go
    continues with step 14; from there on, no further confirmations.
14. **Check and commit everything together** (signed off — the DCO check runs on the PR):
    ```bash
    printf '%s\n' CHANGELOG.md charts/jarvis/CHANGELOG.md .github/release-notes/vX.Y.Z.md \
      | scripts/check-changelogs.sh
    git add CHANGELOG.md README.md charts/jarvis/Chart.yaml charts/jarvis/CHANGELOG.md .github/release-notes/vX.Y.Z.md
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

For validating a batch of changes (e.g. dependency bumps, a CI fix) before
committing to a real release. Tag format: `vX.Y.Z-rc.N` (semver pre-release
identifier — the hyphen is what `release.yml` uses to detect a pre-release).

Unlike a real release, an RC needs **no release branch and no repo changes**
— no CHANGELOG, no README version bump, no chart bump. It's just a tag on
the current `main` HEAD, so it can be pushed directly (tags aren't covered
by the `protect-main` branch ruleset):

```bash
git fetch origin && git status -sb   # must not be ahead/behind, same as Phase 1
git tag -a v1.7.0-rc.1 -m "Release candidate v1.7.0-rc.1"
git push origin v1.7.0-rc.1
```

`release.yml` triggers on any `v*.*.*` tag (the glob matches pre-release
suffixes too) and detects the hyphen to branch its behavior:

- **Image tags**: `docker/metadata-action`'s `latest=auto` default already
  excludes semver pre-releases from the `latest` tag — no workflow change
  needed there. The RC image is pushed as `ghcr.io/kj187/jarvis:1.7.0-rc.1`
  only.
- **Release notes**: no curated notes file, no CHANGELOG section exists for
  an RC tag (those are only generated in Phase 2 of a real release) — the
  body is auto-generated instead: a short blurb + `git log` of commits since
  the last **stable** tag (pre-release tags excluded from that lookup).
- **GitHub Release**: created with `--prerelease` instead of `--latest`, so
  it never overrides the "latest" pointer for the real release that follows.
- **Helm chart**: not published (the `Helm Chart` job is skipped —
  `Chart.yaml` still carries the last stable chart). The release body shows
  how to install the current chart with `--set image.tag=X.Y.Z-rc.N`.

Cutting further RCs (`-rc.2`, …) or the real release afterwards needs no
cleanup — the RC tag/release are independent of the real `vX.Y.Z` tag and
leave no trace in its CHANGELOG or release notes. That relies on
`tag_filter_pattern` in `.chglog/config.yml` (stable `vX.Y.Z` tags only):
without it git-chglog treats the RC tag as the previous tag of `vX.Y.Z` and
renders an empty changelog section. The RC's GitHub Release
entry stays visible in the release list (marked "Pre-release") unless
deleted manually — `gh release delete v1.7.0-rc.1 --cleanup-tag`.

---

## What GitHub Actions does automatically (after tag push)

From `.github/workflows/release.yml`:

Three jobs, strictly in this order — a failure stops everything after it, so
neither a chart nor a GitHub Release ever points at an image that wasn't
built.

**Job `build-and-push`:**
1. Derive image tags via `docker/metadata-action` → `{{version}}` (e.g.
   `1.2.3`) + `{{major}}.{{minor}}` (e.g. `1.2`) + `latest` (metadata-action
   `latest=auto` default on semver tags). **No `v` prefix.**
2. Build multi-arch image (`linux/amd64` + `linux/arm64`) from `Containerfile`
   (multi-stage), with BuildKit SBOM + provenance (`mode=max`), push to GHCR.
3. Sign the image keylessly with **cosign** (GitHub OIDC).
4. Publish **SLSA build provenance** to the GitHub attestations API
   (`actions/attest-build-provenance`, also pushed to the registry) →
   consumers can `gh attestation verify oci://ghcr.io/kj187/jarvis:X.Y.Z --repo kj187/jarvis`.
5. Outputs the image digest for the later jobs.

**Job `chart`** (stable tags only; calls `.github/workflows/chart-release.yml`
via `workflow_call` with `require_image: true`) — see *Helm chart workflow*
below.

**Job `release`** (after `build-and-push`, and `chart` unless skipped for a
pre-release):
1. Generate a standalone **SPDX SBOM** (syft, installed via
   `anchore/sbom-action/download-syft`, run directly against the pushed image
   digest) → `sbom.spdx.json`.
2. Sign it keylessly: `cosign sign-blob --bundle sbom.spdx.json.sigstore.json`
   — consumers verify with `cosign verify-blob`; the `*.sigstore.json` asset
   is also what OpenSSF Scorecard's *Signed-Releases* check looks for.
3. Build the release body: stable tags **require**
   `.github/release-notes/vX.Y.Z.md` (the job fails without it — no silent
   CHANGELOG fallback), then appends image pull + digest, cosign verify,
   `gh attestation verify`, Helm install + chart CHANGELOG link + chart cosign
   verify, and SBOM verify. Pre-release tags get an auto-generated
   commit-log body and an `image.tag` override hint instead of the chart
   section — see [Release Candidates](#release-candidates-pre-releases).
4. Create the GitHub Release via `gh release create --notes-file
   release-body.md --verify-tag` with `sbom.spdx.json` +
   `sbom.spdx.json.sigstore.json` as assets — `--latest` for a real release,
   `--prerelease` for a pre-release tag. Releases are immutable: if a release
   for the tag already exists, the job fails — never overwrite a published
   release; delete it manually first if a re-release is really intended.

**Helm chart workflow** (`.github/workflows/chart-release.yml`):
- Entry points: `workflow_call` from `release.yml` (app releases, after the
  image) and push to `main` touching `charts/**` / `workflow_dispatch`
  ([chart-only releases](#chart-only-release)). Runs are serialized
  (`concurrency: chart-publish`).
- Reads `version` and `appVersion` from `charts/jarvis/Chart.yaml` — chart
  versioning is **decoupled** from the app version and maintained manually.
- Existence guard: if that chart version is already in the registry, the run
  skips publishing (published chart versions are immutable, never overwritten).
- Image guard: publishes only if `ghcr.io/kj187/jarvis:<appVersion>` exists.
  Missing → the release PR merge run skips with a notice (the release
  workflow publishes after the build); the `workflow_call` run fails.
- Otherwise: `helm lint` → `helm package` → `helm push` to
  `oci://ghcr.io/kj187/charts` → keyless **cosign** signature (GitHub OIDC).
- The signing step runs whenever the version exists in the registry and
  verifies before signing, so a `workflow_dispatch` re-run heals a
  published-but-unsigned version.

---

## Prerequisites

- `git-chglog` **v0.15.4** (pinned — template/config behavior, e.g. `.RevertCommits`, is verified against it): `go install github.com/git-chglog/git-chglog/cmd/git-chglog@v0.15.4`
- `gh` CLI authenticated (used for CI checks, run watching, release verify)
- `.chglog/config.yml` must exist
- `GITHUB_TOKEN` in GitHub Actions secrets (injected automatically)
