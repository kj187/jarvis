# Jarvis — Creating a Release

Full release process: generate changelog, set tag, trigger GitHub Actions.

**Never trigger a release automatically.** Load and follow this file only when
the user explicitly asks for a release (root `AGENTS.md` → Workflow Rules #8).

---

## Branch Context

```
# Option A: work on main
git push                        → CI runs (tests, lint, security, build)

# Option B: feature branch → merge first, then release
git checkout -b feature/my-feature
git push && gh pr create        → CI runs on PR
# merge PR → back on main, then release from main
```

---

## Step-by-Step

1. **Check `git status`** — must be clean (no uncommitted changes)
2. **Check current branch** — must be `main` (`git branch --show-current`)
3. **Run tests** in `backend/`: `go test ./...` — must be green
4. **Ask the user**: major / minor / patch or a direct version number (e.g. `v1.2.0`)?
5. **Get last version**: `git describe --tags --abbrev=0`
6. **Calculate new version** using Semver:
   - `patch`: e.g. `v1.2.0` → `v1.2.1`
   - `minor`: e.g. `v1.2.0` → `v1.3.0`
   - `major`: e.g. `v1.2.0` → `v2.0.0`
7. **Generate CHANGELOG**: `git-chglog --output CHANGELOG.md`
8. **Show release notes** for this specific version to the user:
   `git-chglog --output /dev/stdout vX.Y.Z`
   → **Wait for confirmation** before proceeding
9. **Bump version in README** — update the two version occurrences in the Getting Started block:
   ```bash
   PREV=$(git describe --tags --abbrev=0)
   PREV_CLEAN="${PREV#v}"
   sed -i "s|ghcr.io/kj187/jarvis:${PREV_CLEAN}|ghcr.io/kj187/jarvis:X.Y.Z|g" README.md
   sed -i "s|--version ${PREV_CLEAN}|--version X.Y.Z|g" README.md
   ```
   Verify the two occurrences changed (image tag + helm `--version`), then commit together with CHANGELOG:
   ```bash
   git add CHANGELOG.md README.md
   git commit -m "docs: update CHANGELOG for vX.Y.Z"
   ```
10. **Create annotated tag**:
    ```bash
    git tag -a vX.Y.Z -m "Release vX.Y.Z"
    ```
11. **Push tag**:
    ```bash
    git push origin vX.Y.Z
    ```
12. **Generate GitHub Release Description** (show to user, do not post automatically):

    **Rule: is this `v1.0.0` or a new major version (e.g. `v2.0.0`)?**
    → Yes: write an **announcement-style** description (see template A below)
    → No: write a **structured release note** derived from the CHANGELOG (see template B below)

    ---

    **Template A — Initial / major release (v1.0.0, v2.0.0, …)**

    ```markdown
    # 🎉 <Project Name> vX.0.0 — First Public Release

    <One punchy sentence: what this is and why it exists.>

    ---

    ## Why <Project Name>?

    <2-3 sentence problem statement: what existing tools lack, what prompted this.>

    - **<Feature>** — <one-line why it matters>
    - **<Feature>** — <one-line why it matters>
    - *(mirror the "Why Jarvis?" section from README)*

    ---

    ## What's in this release

    <Narrative paragraph — not a bullet dump. Highlight the 3-5 most important capabilities and what makes them interesting.>

    Full feature list → [README](README.md)

    ---

    ## Getting started

    \`\`\`bash
    # paste the quickstart snippet from README
    \`\`\`

    Full docs → [README](README.md) · [Configuration](.env.example) · [Helm chart](charts/)

    ---

    ## Tech stack

    <single line: languages, frameworks, key libs>

    ---

    > **Built with AI** — <copy the "Built with AI" note from README if applicable>

    ---

    *Feedback and contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).*
    ```

    ---

    **Template B — Regular patch / minor / major release**

    ```markdown
    ## What's changed

    <One sentence summarising the theme of this release (e.g. "Focus on stability and PostgreSQL reliability").>

    ### Added
    - <item from CHANGELOG>

    ### Fixed
    - <item from CHANGELOG>

    ### Security
    - <item from CHANGELOG>

    ### Changed
    - <item from CHANGELOG> *(only if relevant to users — skip pure dep bumps)*

    ---

    **Full diff:** [vPREV...vNEW](https://github.com/kj187/jarvis/compare/vPREV...vNEW)
    **Container image:** `ghcr.io/kj187/jarvis:X.Y.Z`
    ```

    → Present the filled-out description to the user and ask: *"Does this look good? I'll copy it to your clipboard / you can paste it into the GitHub Release."*
    → Do **not** post it to GitHub automatically.

13. **Inform about next steps**:
    - GitHub Actions is now running: https://github.com/kj187/jarvis/actions
    - Release will be created at: https://github.com/kj187/jarvis/releases
    - Container image will be pushed to: `ghcr.io/kj187/jarvis:X.Y.Z` + `ghcr.io/kj187/jarvis:X.Y` (no `v` prefix, no `:latest` image tag — the GitHub Release itself is marked "latest")
    - A signed (cosign) multi-arch image (amd64 + arm64) and the Helm chart are published automatically

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

```bash
# Patch bump directly (e.g. v1.2.0 → v1.2.1)
git tag -a v1.2.1 -m "fix: <short description>"
git push origin v1.2.1
```

---

## What GitHub Actions does automatically (after tag push)

From `.github/workflows/release.yml`:

**Job `build-and-push`:**
1. Derive image tags via `docker/metadata-action` → `{{version}}` (e.g. `1.2.3`) + `{{major}}.{{minor}}` (e.g. `1.2`). **No `v` prefix, no `:latest` image tag.**
2. Build multi-arch image (`linux/amd64` + `linux/arm64`) from `Containerfile` (multi-stage), with SBOM + provenance, push to GHCR.
3. Sign the image keylessly with **cosign** (GitHub OIDC).
4. Build the release body by extracting this version's section from `CHANGELOG.md` (awk) and appending pull/cosign-verify instructions.
5. Create the GitHub Release via `gh release create --notes-file release-body.md --latest` (the `--latest` flag marks the *GitHub Release* as latest, not a Docker tag). Releases are immutable: if a release for the tag already exists, the job fails — never overwrite a published release; delete it manually first if a re-release is really intended.

**Job `helm-publish`:**
6. Patch `charts/jarvis/Chart.yaml` (`version` + `appVersion`) to the release version.
7. Package and push the Helm chart to `oci://ghcr.io/kj187/charts`.

---

## Prerequisites

- `git-chglog` must be installed: `go install github.com/git-chglog/git-chglog/cmd/git-chglog@latest`
- `.chglog/config.yml` must exist
- `GITHUB_TOKEN` in GitHub Actions secrets (injected automatically)
