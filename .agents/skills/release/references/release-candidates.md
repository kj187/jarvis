# Release Candidates (Pre-releases)

Background reference for `.agents/skills/release/SKILL.md` — read this only
when the user asks for a release candidate, not during a normal release.

For validating a batch of changes (e.g. dependency bumps, a CI fix) before
committing to a real release. Tag format: `vX.Y.Z-rc.N` (semver pre-release
identifier). Only `vX.Y.Z` and `vX.Y.Z-rc.N` are accepted; other pre-release
tags fail validation in the `build-and-push` job (scripts/release-body.sh
validates the tag strictly).

Unlike a real release, an RC needs **no release branch and no repo changes**
— no CHANGELOG, no README version bump, no chart bump. The notes file
(`.github/release-notes/vX.Y.Z.md`, if wanted) is optional and, if needed, brought
to `main` ahead of time via a normal PR (all changes to `main` are PR-only —
Workflow Rules #10). The RC tag itself is a pure tag with no repo changes, pushed
directly (tags aren't covered by the `protect-main` branch ruleset):

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
- **Release notes**: when `.github/release-notes/vX.Y.Z.md` exists in the
  tagged commit and is not empty (whitespace-only counts as missing), the RC
  body uses it with a note that this is a pre-release and notes may still
  change. Otherwise, auto-generated fallback: a short blurb + `git log` of
  commits since the last **stable** tag (pre-release tags excluded from that
  lookup). No CHANGELOG section is generated for an RC tag (those are only
  in Phase 2 of a real release).
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

## Updating release notes after tagging

To update the notes part (everything before the artifact sections) of an existing
release without re-tagging, use the **"Refresh release notes"** workflow (manual dispatch,
`.github/workflows/release-notes-refresh.yml`). This is the reproducible way to keep
artifact sections, pre-release flag, latest-pointer and assets intact.

1. Make sure `.github/release-notes/vX.Y.Z.md` (the base version file, without
   `-rc.N`) is updated on `main` — via a normal PR if changes are needed.
2. Go to **Actions** → **Refresh release notes** → **Run workflow** (branch:
   `main`, tag input: `v1.7.0-rc.1` or `v1.7.0`).
3. The workflow reads the notes file from `main`, replaces the notes part (everything
   before `<!-- jarvis:artifacts -->`) in the existing release, and leaves the
   artifact sections, assets, pre-release flag and latest-pointer untouched.

The workflow works for both RC and stable releases, but only if the release
body already contains the marker and the notes file is not empty. If a release
lacks the marker (created before the marker existed), the workflow exits with
"Edit the release by hand" — use `gh release edit` or the GitHub web UI instead,
taking care to preserve the artifact sections.

---
