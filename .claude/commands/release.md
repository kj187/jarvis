---
description: Full release process — changelog generation, semver bump, tag, GHCR push, GitHub Release
---

# Jarvis — Creating a Release

Slash-Command: `/project:release`

Full release process: generate changelog, set tag, trigger GitHub Actions.

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
9. **Commit CHANGELOG**:
   ```bash
   git add CHANGELOG.md
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
12. **Inform about next steps**:
    - GitHub Actions is now running: https://github.com/kj187/jarvis/actions
    - Release will be created at: https://github.com/kj187/jarvis/releases
    - Container image will be pushed to: `ghcr.io/kj187/jarvis:vX.Y.Z` + `ghcr.io/kj187/jarvis:latest`

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
1. `git-chglog --output RELEASE_NOTES.md vX.Y.Z` — generate release notes for this version
2. Build container image + push to GHCR (`ghcr.io/kj187/jarvis:vX.Y.Z` + `:latest`)
3. Create GitHub Release with the generated release notes

---

## Prerequisites

- `git-chglog` must be installed: `go install github.com/git-chglog/git-chglog/cmd/git-chglog@latest`
- `.chglog/config.yml` must exist
- `GITHUB_TOKEN` in GitHub Actions secrets (injected automatically)
