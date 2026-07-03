# Jarvis — Creating a Release

Fully automated release: `/release X.Y.Z` runs end-to-end without further
questions — preflight, changelog, curated release notes, version bumps, tag,
push, CI monitoring.

**Never trigger a release without an explicit user request.** Load and follow
this file only when the user explicitly asks for a release (root `AGENTS.md`
→ Workflow Rules #8). Once the user has asked, run the whole flow without
stopping for confirmations.

---

## Input

The user provides the target version as argument (`/release 1.6.0`) or in
prose. Accept `X.Y.Z` or `vX.Y.Z`; normalize to tag `vX.Y.Z`. If **no**
version is given, derive the bump from the commits since the last tag
(Conventional Commits → semver table below) and state the derived version in
the final report — do not ask.

---

## Step-by-Step (non-interactive)

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

### Phase 2 — Prepare release commit

6. **Generate CHANGELOG** (tag does not exist yet → `--next-tag`):
   ```bash
   git-chglog --next-tag vX.Y.Z --output CHANGELOG.md
   ```
7. **Write curated release notes** to `.github/release-notes/vX.Y.Z.md`.
   The release workflow uses this file as the release body and **appends**
   the artifact sections itself (image digest, cosign/attestation verify,
   Helm install, SBOM) — do **not** include those in the notes file.
   - `vX.0.0` (first or new major) → Template A below
   - otherwise → Template B below
8. **Bump versions in README** — the two occurrences in the Getting Started
   block:
   ```bash
   PREV=$(git describe --tags --abbrev=0)
   PREV_CLEAN="${PREV#v}"
   sed -i "s|ghcr.io/kj187/jarvis:${PREV_CLEAN}|ghcr.io/kj187/jarvis:X.Y.Z|g" README.md
   sed -i "s|--version ${PREV_CLEAN}|--version X.Y.Z|g" README.md
   ```
   Verify both occurrences changed (image tag + helm `--version`).
9. **Bump chart versions** in `charts/jarvis/Chart.yaml` — chart version is
   **decoupled** from the app version, but an app release must ship a chart
   that deploys it:
   - `appVersion`: new app version (`"X.Y.Z"`, quoted)
   - `version`: bump by the impact of the chart change itself
     (appVersion-only bump → patch)
10. **Commit everything together**:
    ```bash
    git add CHANGELOG.md README.md charts/jarvis/Chart.yaml .github/release-notes/vX.Y.Z.md
    git commit -m "chore(release): prepare vX.Y.Z"
    ```

### Phase 3 — Tag & push

11. **Create annotated tag**:
    ```bash
    git tag -a vX.Y.Z -m "Release vX.Y.Z"
    ```
12. **Push tag first, then main** (order matters: the tag triggers the image
    build + GitHub Release; the main push triggers the chart publish, which
    references the new image via `appVersion`):
    ```bash
    git push origin vX.Y.Z
    git push origin main
    ```

### Phase 4 — Monitor & verify (done-gate)

13. Watch both workflows to completion:
    ```bash
    gh run list --workflow=release.yml --limit 1
    gh run watch <run-id> --exit-status
    gh run list --workflow=chart-release.yml --limit 1   # only runs if chart version is new
    ```
14. Verify the release exists and report to the user:
    ```bash
    gh release view vX.Y.Z --json url,assets
    ```
    Final report must include: release URL, image ref
    `ghcr.io/kj187/jarvis:X.Y.Z`, chart version, and whether the SBOM asset
    is attached. If any workflow failed, report the failing step and log
    excerpt — never claim success.

---

## Release-Notes Templates

Write the notes file in English, derived from the CHANGELOG section and the
actual commits (read them — don't just reformat commit subjects). No
artifact/verify sections — the workflow appends those.

**Template A — Initial / major release (v1.0.0, v2.0.0, …)**

```markdown
# 🎉 <Project Name> vX.0.0 — <headline>

<One punchy sentence: what this is and why it exists.>

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

Omit empty sections.

---

## Version Scheme (Semver)

| Bump | When | Commit type |
|---|---|---|
| `PATCH` | Bug fix, security patch, small improvements | `fix:`, `security:` |
| `MINOR` | New feature, backwards-compatible | `feat:` |
| `MAJOR` | Breaking change (API, config format, DB schema migration required) | `BREAKING CHANGE:` |

First stable release: `v1.0.0`. Before that: `v0.x.y` (no stability guarantee).

---

## Hotfix Release

Same flow — `/release X.Y.(Z+1)` from `main` after the fix is merged. There
is no separate fast path: the notes file and CHANGELOG are cheap and keep the
release history consistent.

---

## What GitHub Actions does automatically (after tag push)

From `.github/workflows/release.yml`:

**Job `build-and-push`:**
1. Derive image tags via `docker/metadata-action` → `{{version}}` (e.g.
   `1.2.3`) + `{{major}}.{{minor}}` (e.g. `1.2`). **No `v` prefix, no
   `:latest` image tag.**
2. Build multi-arch image (`linux/amd64` + `linux/arm64`) from `Containerfile`
   (multi-stage), with BuildKit SBOM + provenance (`mode=max`), push to GHCR.
3. Sign the image keylessly with **cosign** (GitHub OIDC).
4. Publish **SLSA build provenance** to the GitHub attestations API
   (`actions/attest-build-provenance`, also pushed to the registry) →
   consumers can `gh attestation verify oci://ghcr.io/kj187/jarvis:X.Y.Z --repo kj187/jarvis`.
5. Generate a standalone **SPDX SBOM** (`anchore/sbom-action` / syft) →
   attached to the GitHub Release as `sbom.spdx.json`.
6. Build the release body: uses `.github/release-notes/vX.Y.Z.md` if present
   (fallback: awk-extract this version's CHANGELOG section), then appends
   image pull + digest, cosign verify, `gh attestation verify`, Helm install
   + chart cosign verify, and SBOM pointers.
7. Create the GitHub Release via `gh release create --notes-file
   release-body.md --verify-tag --latest` with the SBOM as asset. Releases
   are immutable: if a release for the tag already exists, the job fails —
   never overwrite a published release; delete it manually first if a
   re-release is really intended.

**Helm chart** (separate workflow `.github/workflows/chart-release.yml`, *not*
part of `release.yml`):
- Triggers on every push to `main` that touches `charts/**` (and via
  `workflow_dispatch`).
- Reads `version` from `charts/jarvis/Chart.yaml` — chart versioning is
  **decoupled** from the app version and maintained manually in the repo.
- Existence guard: if that chart version is already in the registry, the run
  skips publishing (published chart versions are immutable, never overwritten).
- Otherwise: `helm lint` → `helm package` → `helm push` to
  `oci://ghcr.io/kj187/charts` → keyless **cosign** signature (GitHub OIDC).
- The signing step runs on every execution and verifies before signing, so a
  `workflow_dispatch` re-run heals a published-but-unsigned version.

---

## Prerequisites

- `git-chglog` must be installed: `go install github.com/git-chglog/git-chglog/cmd/git-chglog@latest`
- `gh` CLI authenticated (used for CI checks, run watching, release verify)
- `.chglog/config.yml` must exist
- `GITHUB_TOKEN` in GitHub Actions secrets (injected automatically)
