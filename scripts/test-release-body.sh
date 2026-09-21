#!/usr/bin/env bash
# Tests for scripts/release-body.sh (release body build + notes refresh).
#
# Runs against throwaway git repositories, never the real one, and needs no
# network or GitHub access. Usage: scripts/test-release-body.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/release-body.sh"
MARKER='<!-- jarvis:artifacts -->'
DIGEST="sha256:$(printf 'a%.0s' $(seq 1 64))"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

passed=0
failed=0

pass() { passed=$((passed + 1)); echo "  ok   $1"; }
fail() { failed=$((failed + 1)); echo "  FAIL $1" >&2; [ -z "${2:-}" ] || echo "       $2" >&2; }

# rejects <name> <error regex>: the last run failed, printed no body on stdout
# and its stderr matches the regex, so a missing script never counts as a
# correct rejection.
rejects() {
  if [ "$RC" -ne 0 ] && [ ! -s "$OUT" ] && grep -qE -- "$2" "$ERR"; then
    pass "$1"
  else
    fail "$1" "rc=$RC stderr: $(head -c 200 "$ERR")"
  fi
}

# outputs <name> <expected>: the last run succeeded and printed exactly <expected>.
outputs() {
  if [ "$RC" -eq 0 ] && [ -s "$OUT" ] && [ "$(cat "$OUT")" = "$2" ]; then
    pass "$1"
  else
    fail "$1" "rc=$RC stdout: $(head -c 200 "$OUT") stderr: $(head -c 200 "$ERR")"
  fi
}

has() { grep -qF -- "$2" "$1"; }
# lacks needs a non-empty file, so a failed run cannot satisfy a negative check.
lacks() { [ -s "$1" ] && ! grep -qF -- "$2" "$1"; }
count() { grep -cF -- "$2" "$1"; }

# Fresh repo with a stable tag v1.12.0, one commit after it, notes for v1.13.0.
new_repo() {
  local dir="$TMP/repo-$1"
  mkdir -p "$dir/.github/release-notes"
  (
    cd "$dir" || exit 1
    git init -q .
    git config user.email test@example.invalid
    git config user.name test
    git config commit.gpgsign false
    git commit -q --allow-empty -m 'chore: initial'
    git tag v1.12.0
    git commit -q --allow-empty -m 'feat(alerts): add the thing'
  )
  echo "$dir"
}

write_notes() { # <repo> <tag> <text>
  printf '%s\n' "$3" > "$1/.github/release-notes/$2.md"
}

# run <repo> <args...>: sets OUT (stdout file), ERR (stderr file), RC.
run() {
  local repo="$1"; shift
  OUT="$repo/.out"; ERR="$repo/.err"
  (cd "$repo" && bash "$SCRIPT" "$@") > "$OUT" 2> "$ERR"
  RC=$?
}

echo "release-body.sh"

# ── validate-tag ─────────────────────────────────────────────────────────────
repo="$(new_repo validate)"
for tag in v1.13.0 v1.13.0-rc.1 v10.20.30-rc.12; do
  run "$repo" validate-tag "$tag"
  [ "$RC" -eq 0 ] && pass "validate-tag accepts $tag" || fail "validate-tag accepts $tag"
done
for tag in 1.13.0 v1.13 v1.13.0-beta.1 v1.13.0-rc v1.13.0-rc.1.2 'v1.13.0;id' 'v1.13.0 ' $'v1.13.0\nx' '' '$(id)'; do
  run "$repo" validate-tag "$tag"
  rejects "validate-tag rejects $(printf '%q' "$tag")" 'invalid tag'
done

# ── build: RC with curated notes ─────────────────────────────────────────────
repo="$(new_repo rc-notes)"
write_notes "$repo" v1.13.0 $'## What\'s changed\n\nCurated line one.\n\n### Breaking Changes\n- No breaking changes.'
run "$repo" build v1.13.0-rc.1 "$DIGEST" 2.1.0
[ "$RC" -eq 0 ] && pass "RC with notes: exits 0" || fail "RC with notes: exits 0" "$(cat "$ERR")"
has "$OUT" 'Release candidate' && pass "RC with notes: RC hint present" || fail "RC with notes: RC hint present"
has "$OUT" 'Not published as `latest`' && pass "RC with notes: hint names latest" || fail "RC with notes: hint names latest"
has "$OUT" 'Curated line one.' && pass "RC with notes: curated notes used" || fail "RC with notes: curated notes used"
lacks "$OUT" 'Pre-release build' && pass "RC with notes: no commit-list fallback" || fail "RC with notes: no commit-list fallback"
lacks "$OUT" 'add the thing' && pass "RC with notes: no commit subjects" || fail "RC with notes: no commit subjects"
[ "$(count "$OUT" "$MARKER")" -eq 1 ] && pass "RC with notes: exactly one marker" || fail "RC with notes: exactly one marker"
has "$OUT" 'docker pull ghcr.io/kj187/jarvis:1.13.0-rc.1' && pass "RC with notes: image tag substituted" || fail "RC with notes: image tag substituted"
has "$OUT" "$DIGEST" && pass "RC with notes: digest substituted" || fail "RC with notes: digest substituted"
has "$OUT" "Release candidates don't publish a chart" && pass "RC with notes: RC chart section" || fail "RC with notes: RC chart section"
has "$OUT" '--version 2.1.0 --set image.tag=1.13.0-rc.1' && pass "RC with notes: chart version substituted" || fail "RC with notes: chart version substituted"
if [ ! -s "$OUT" ] || grep -qE '@(VERSION|DIGEST|CHART_VERSION|TAG)@' "$OUT"; then fail "RC with notes: no unresolved placeholders"; else pass "RC with notes: no unresolved placeholders"; fi
n_notes="$(grep -nF 'Curated line one.' "$OUT" | head -1 | cut -d: -f1)"
n_marker="$(grep -nF "$MARKER" "$OUT" | head -1 | cut -d: -f1)"
n_image="$(grep -nF '## Container image' "$OUT" | head -1 | cut -d: -f1)"
[ "$n_notes" -lt "$n_marker" ] && [ "$n_marker" -lt "$n_image" ] \
  && pass "RC with notes: order notes < marker < artifacts" || fail "RC with notes: order notes < marker < artifacts"
[ -n "$n_marker" ] && [ "$(sed -n "$((n_marker + 1))p" "$OUT")" = "" ] && pass "RC with notes: blank line after marker" || fail "RC with notes: blank line after marker"

# A later RC of the same base version reuses the same notes file.
run "$repo" build v1.13.0-rc.2 "$DIGEST" 2.1.0
{ [ "$RC" -eq 0 ] && has "$OUT" 'Curated line one.'; } && pass "rc.2 uses the base-version notes" || fail "rc.2 uses the base-version notes"

# ── build: RC without notes falls back to the commit list ────────────────────
repo="$(new_repo rc-fallback)"
git -C "$repo" tag v1.13.0-rc.1
run "$repo" build v1.13.0-rc.1 "$DIGEST" 2.1.0
[ "$RC" -eq 0 ] && pass "RC without notes: exits 0" || fail "RC without notes: exits 0" "$(cat "$ERR")"
has "$OUT" '## Pre-release build' && pass "RC without notes: fallback heading" || fail "RC without notes: fallback heading"
has "$OUT" '**Commits since v1.12.0:**' && pass "RC without notes: names last stable tag" || fail "RC without notes: names last stable tag"
has "$OUT" '- feat(alerts): add the thing (' && pass "RC without notes: lists commits" || fail "RC without notes: lists commits"
[ "$(count "$OUT" "$MARKER")" -eq 1 ] && pass "RC without notes: exactly one marker" || fail "RC without notes: exactly one marker"
lacks "$OUT" 'initial' && pass "RC without notes: only commits after last stable" || fail "RC without notes: only commits after last stable"

# ── build: stable ────────────────────────────────────────────────────────────
repo="$(new_repo stable)"
write_notes "$repo" v1.13.0 $'## What\'s changed\n\nStable curated line.'
run "$repo" build v1.13.0 "$DIGEST" 2.1.0
[ "$RC" -eq 0 ] && pass "stable with notes: exits 0" || fail "stable with notes: exits 0" "$(cat "$ERR")"
has "$OUT" 'Stable curated line.' && pass "stable with notes: curated notes used" || fail "stable with notes: curated notes used"
lacks "$OUT" 'Release candidate' && pass "stable with notes: no RC hint" || fail "stable with notes: no RC hint"
has "$OUT" 'cosign verify ghcr.io/kj187/charts/jarvis:2.1.0' && pass "stable with notes: chart signature section" || fail "stable with notes: chart signature section"
has "$OUT" 'blob/v1.13.0/charts/jarvis/CHANGELOG.md' && pass "stable with notes: tag substituted in changelog link" || fail "stable with notes: tag substituted in changelog link"
[ "$(count "$OUT" "$MARKER")" -eq 1 ] && pass "stable with notes: exactly one marker" || fail "stable with notes: exactly one marker"

repo="$(new_repo stable-missing)"
run "$repo" build v1.13.0 "$DIGEST" 2.1.0
rejects "stable without notes: fails" 'release-notes/v1\.13\.0\.md is missing or empty'

# An empty or whitespace-only notes file counts as missing: a stable release
# must not ship an empty body, an RC falls back to the commit list.
repo="$(new_repo notes-empty)"
git -C "$repo" tag v1.13.0-rc.1
for content in '' $'  \n\n\t\n'; do
  printf '%s' "$content" > "$repo/.github/release-notes/v1.13.0.md"
  label="$(printf '%q' "$content")"
  run "$repo" build v1.13.0 "$DIGEST" 2.1.0
  rejects "stable with empty notes $label: fails" 'release-notes/v1\.13\.0\.md is missing or empty'
  run "$repo" build v1.13.0-rc.1 "$DIGEST" 2.1.0
  { [ "$RC" -eq 0 ] && has "$OUT" '## Pre-release build' && lacks "$OUT" 'Release candidate.**'; } \
    && pass "RC with empty notes $label: commit-list fallback" || fail "RC with empty notes $label: commit-list fallback"
  cp "$OUT" "$repo/old-empty.md"
  run "$repo" refresh v1.13.0 "$repo/old-empty.md"
  rejects "refresh stable with empty notes $label: fails" 'missing or empty'
  run "$repo" refresh v1.13.0-rc.1 "$repo/old-empty.md"
  rejects "refresh RC with empty notes $label: fails" 'missing or empty'
done

# ── build: input validation ──────────────────────────────────────────────────
repo="$(new_repo build-invalid)"
write_notes "$repo" v1.13.0 'notes'
run "$repo" build 'v1.13.0;id' "$DIGEST" 2.1.0
rejects "build rejects an invalid tag" 'invalid tag'
run "$repo" build v1.13.0 'sha256:zz' 2.1.0
rejects "build rejects an invalid digest" 'invalid image digest'
run "$repo" build v1.13.0 "$DIGEST" '2.1.0|x'
rejects "build rejects an invalid chart version" 'invalid chart version'
run "$repo" build v1.13.0
rejects "build rejects missing arguments" 'Usage'

# Notes that contain the marker would make a later refresh ambiguous.
write_notes "$repo" v1.13.0 "text $MARKER text"
run "$repo" build v1.13.0 "$DIGEST" 2.1.0
rejects "build rejects notes containing the marker" 'reserved for the release workflow'

# ── refresh ──────────────────────────────────────────────────────────────────
# Existing body as the release workflow wrote it, with old notes on top.
repo="$(new_repo refresh)"
write_notes "$repo" v1.13.0 $'## What\'s changed\n\nOld notes.'
run "$repo" build v1.13.0 "$DIGEST" 2.1.0
cp "$OUT" "$repo/old-stable.md"
write_notes "$repo" v1.13.0 $'## What\'s changed\n\nNew notes after the refresh.'

run "$repo" refresh v1.13.0 old-stable.md
[ "$RC" -eq 0 ] && pass "refresh stable: exits 0" || fail "refresh stable: exits 0" "$(cat "$ERR")"
has "$OUT" 'New notes after the refresh.' && pass "refresh stable: new notes in body" || fail "refresh stable: new notes in body"
lacks "$OUT" 'Old notes.' && pass "refresh stable: old notes gone" || fail "refresh stable: old notes gone"
[ "$(count "$OUT" "$MARKER")" -eq 1 ] && pass "refresh stable: exactly one marker" || fail "refresh stable: exactly one marker"
tail_new="$(sed -n "/^$MARKER\$/,\$p" "$OUT")"
tail_old="$(sed -n "/^$MARKER\$/,\$p" "$repo/old-stable.md")"
[ -n "$tail_old" ] && [ "$tail_new" = "$tail_old" ] && pass "refresh stable: artifact sections unchanged" || fail "refresh stable: artifact sections unchanged"

# Refreshing with unchanged notes is a no-op (byte-identical).
write_notes "$repo" v1.13.0 $'## What\'s changed\n\nOld notes.'
run "$repo" refresh v1.13.0 old-stable.md
[ -s "$OUT" ] && cmp -s "$OUT" "$repo/old-stable.md" && pass "refresh stable: unchanged notes give an identical body" || fail "refresh stable: unchanged notes give an identical body"

# RC: notes come from the base version's file, the RC hint stays.
write_notes "$repo" v1.13.0 $'## What\'s changed\n\nRC notes v1.'
run "$repo" build v1.13.0-rc.1 "$DIGEST" 2.1.0
cp "$OUT" "$repo/old-rc.md"
write_notes "$repo" v1.13.0 $'## What\'s changed\n\nRC notes v2.'
run "$repo" refresh v1.13.0-rc.1 old-rc.md
[ "$RC" -eq 0 ] && pass "refresh RC: exits 0" || fail "refresh RC: exits 0" "$(cat "$ERR")"
has "$OUT" 'RC notes v2.' && lacks "$OUT" 'RC notes v1.' && pass "refresh RC: base-version notes replaced" || fail "refresh RC: base-version notes replaced"
has "$OUT" 'Release candidate' && pass "refresh RC: RC hint kept" || fail "refresh RC: RC hint kept"
tail_new="$(sed -n "/^$MARKER\$/,\$p" "$OUT")"
tail_old="$(sed -n "/^$MARKER\$/,\$p" "$repo/old-rc.md")"
[ -n "$tail_old" ] && [ "$tail_new" = "$tail_old" ] && pass "refresh RC: artifact sections unchanged" || fail "refresh RC: artifact sections unchanged"

# An RC that so far only had the commit-list fallback gets curated notes.
rm "$repo/.github/release-notes/v1.13.0.md"
git -C "$repo" tag v1.13.0-rc.1
run "$repo" build v1.13.0-rc.1 "$DIGEST" 2.1.0
cp "$OUT" "$repo/old-rc-fallback.md"
write_notes "$repo" v1.13.0 $'## What\'s changed\n\nNow curated.'
run "$repo" refresh v1.13.0-rc.1 old-rc-fallback.md
{ [ "$RC" -eq 0 ] && has "$OUT" 'Now curated.' && lacks "$OUT" 'Pre-release build'; } \
  && pass "refresh RC: fallback body upgraded to curated notes" || fail "refresh RC: fallback body upgraded to curated notes"

# No notes file on the ref: nothing to refresh, never a guess.
rm "$repo/.github/release-notes/v1.13.0.md"
run "$repo" refresh v1.13.0-rc.1 old-rc.md
rejects "refresh RC without notes file: fails, no output" 'missing or empty'
run "$repo" refresh v1.13.0 old-stable.md
rejects "refresh stable without notes file: fails, no output" 'missing or empty'

# Body without the marker (release created before the marker existed).
write_notes "$repo" v1.13.0 'new notes'
printf '## What'"'"'s changed\n\nLegacy notes.\n\n---\n\n## Container image\n' > "$repo/legacy.md"
run "$repo" refresh v1.13.0 legacy.md
rejects "refresh without marker: fails, no output" 'has no .* marker'

# Ambiguous body: marker twice.
{ cat "$repo/old-stable.md"; echo "$MARKER"; } > "$repo/twice.md"
run "$repo" refresh v1.13.0 twice.md
rejects "refresh with two markers: fails, no output" 'more than one'

# Marker only counts as a whole line (quoted inside prose it is not the marker).
printf 'text with %s inline\n\n---\n' "$MARKER" > "$repo/inline.md"
run "$repo" refresh v1.13.0 inline.md
rejects "refresh: inline marker mention is not a marker" 'has no .* marker'

# Body edited in the web UI can carry CRLF line endings.
sed 's/$/\r/' "$repo/old-stable.md" > "$repo/crlf.md"
run "$repo" refresh v1.13.0 crlf.md
{ [ "$RC" -eq 0 ] && has "$OUT" 'new notes' && [ "$(count "$OUT" 'Container image')" -ge 1 ]; } \
  && pass "refresh: CRLF body is accepted" || fail "refresh: CRLF body is accepted" "$(cat "$ERR")"

# Invalid tag and missing body file.
run "$repo" refresh 'v1.13.0;id' old-stable.md
rejects "refresh rejects an invalid tag" 'invalid tag'
run "$repo" refresh v1.13.0 does-not-exist.md
rejects "refresh rejects a missing body file" 'not found'

# ── latest-flag: which make_latest flag the notes refresh passes ─────────────
repo="$(new_repo latest-flag)"
run "$repo" latest-flag false v1.13.0 v1.13.0
outputs "latest-flag: stable and current latest keeps latest" '--latest'
run "$repo" latest-flag false v1.12.0 v1.13.0
outputs "latest-flag: stable but not latest stays not latest" '--latest=false'
run "$repo" latest-flag true v1.12.0 v1.13.0-rc.1
outputs "latest-flag: RC is never latest" '--latest=false'
run "$repo" latest-flag true none v1.13.0-rc.1
outputs "latest-flag: RC without any latest release is fine" '--latest=false'
run "$repo" latest-flag true v1.13.0 v1.13.0
outputs "latest-flag: prerelease is never latest, even if named latest" '--latest=false'
run "$repo" latest-flag false none v1.13.0
rejects "latest-flag: stable and no latest release is refused" 'no latest release found, refusing to edit'
run "$repo" latest-flag maybe v1.12.0 v1.13.0
rejects "latest-flag: invalid isPrerelease" "invalid isPrerelease"
run "$repo" latest-flag false v1.12.0 'v1.13.0;id'
rejects "latest-flag: invalid tag" 'invalid tag'
run "$repo" latest-flag false '' v1.13.0
rejects "latest-flag: empty latest tag" 'invalid latest tag'
run "$repo" latest-flag false 'v1.12.0;id' v1.13.0
rejects "latest-flag: injectable latest tag" 'invalid latest tag'
run "$repo" latest-flag false null v1.13.0
rejects "latest-flag: null latest tag" 'invalid latest tag'
run "$repo" latest-flag false v1.12.0
rejects "latest-flag: missing arguments" 'Usage'

# ── verify-unchanged: state before and after the edit must match ─────────────
run "$repo" verify-unchanged false v1.12.0 false v1.12.0
[ "$RC" -eq 0 ] && pass "verify-unchanged: identical state passes" || fail "verify-unchanged: identical state passes" "$(cat "$ERR")"
run "$repo" verify-unchanged true none true none
[ "$RC" -eq 0 ] && pass "verify-unchanged: identical RC state passes" || fail "verify-unchanged: identical RC state passes" "$(cat "$ERR")"
run "$repo" verify-unchanged true v1.12.0 false v1.12.0
rejects "verify-unchanged: isPrerelease changed" 'isPrerelease changed from true to false'
run "$repo" verify-unchanged false v1.12.0 false v1.13.0
rejects "verify-unchanged: latest release changed" 'latest release changed from v1.12.0 to v1.13.0'
run "$repo" verify-unchanged false none false v1.12.0
rejects "verify-unchanged: latest appeared" 'latest release changed from none to v1.12.0'
run "$repo" verify-unchanged false v1.12.0 false
rejects "verify-unchanged: missing arguments" 'Usage'
run "$repo" verify-unchanged false v1.12.0 false ''
rejects "verify-unchanged: empty value never counts as a state" 'invalid latest tag'

# ── unknown command ──────────────────────────────────────────────────────────
run "$repo" nonsense
rejects "unknown command fails" 'Usage'

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
