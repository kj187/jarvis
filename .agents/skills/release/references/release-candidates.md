# Release Candidates (Pre-releases)

Background reference for `.agents/skills/release/SKILL.md` — read this only
when the user asks for a release candidate, not during a normal release.

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
