#!/usr/bin/env bash
# Builds and refreshes the GitHub Release body for a Jarvis tag.
#
# A release body has two parts, separated by an HTML comment marker:
#   1. the notes: curated notes from .github/release-notes/<version>.md (a
#      release candidate uses the file of its base version, without -rc.N),
#   2. the artifact sections (image, digest, cosign, Helm chart, SBOM), which
#      only the release workflow can write.
#
# Usage (run from the repository root; output goes to stdout):
#   release-body.sh validate-tag <tag>
#   release-body.sh build   <tag> <image-digest> <chart-version>
#   release-body.sh refresh <tag> <existing-body-file>
#   release-body.sh latest-flag <isPrerelease> <latest-tag|none> <tag>
#   release-body.sh verify-unchanged <isPrerelease-before> <latest-before> <isPrerelease-after> <latest-after>
#
# build    full body for a fresh release. Stable tags require a notes file. A
#          release candidate uses the notes file when it exists and otherwise
#          falls back to the list of commits since the last stable tag. An
#          empty (whitespace-only) notes file counts as missing.
# refresh  the existing body with only the notes part replaced from the notes
#          file in the working tree; everything from the marker on is kept
#          byte for byte. Fails (prints nothing) if the notes file is missing
#          or the body has no marker (a release created before the marker
#          existed) rather than guessing where the notes end.
# latest-flag  the make_latest flag for `gh release edit` of <tag>: `--latest`
#          only when <tag> is a stable release and already the latest one,
#          otherwise `--latest=false`, so an edit never moves the latest
#          pointer. Refuses (stable tag while no latest release exists) rather
#          than guessing.
# verify-unchanged  fails when isPrerelease or the latest release differs
#          between the state read before and after the edit.
#
# The tag must look like vX.Y.Z or vX.Y.Z-rc.N. The image tag, digest and
# chart version are validated because they end up inside code blocks.

set -euo pipefail

MARKER='<!-- jarvis:artifacts -->'
TAG_RE='^v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$'
DIGEST_RE='^sha256:[0-9a-f]{64}$'
CHART_VERSION_RE='^[0-9A-Za-z][0-9A-Za-z.+-]*$'
NOTES_DIR=".github/release-notes"

die() {
  echo "::error::$*" >&2
  exit 1
}

usage() {
  sed -n '/^# Usage/,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

validate_tag() {
  [[ "${1:-}" =~ $TAG_RE ]] || die "invalid tag '${1:-}': expected vX.Y.Z or vX.Y.Z-rc.N"
}

# Values read from the GitHub API end up in flags and messages: validate them.
validate_prerelease() {
  [[ "${1:-}" == true || "${1:-}" == false ]] || die "invalid isPrerelease '${1:-}': expected true or false"
}

# A tag name as GitHub reports it, or "none" when the repository has no latest release.
validate_latest_tag() {
  [[ "${1:-}" =~ ^[A-Za-z0-9._-]+$ && "${1:-}" != null ]] || die "invalid latest tag '${1:-}'"
}

is_rc() { [[ "$1" == *-* ]]; }

# Path of the notes file for a tag; a release candidate uses its base version.
notes_file() { echo "${NOTES_DIR}/${1%%-*}.md"; }

# Prints the notes part of the body for TAG, ending in a newline.
# Returns 1 when the notes file is missing or empty (whitespace only).
notes_head() {
  local tag="$1" file
  file="$(notes_file "$tag")"
  if [ ! -f "$file" ] || ! grep -q '[^[:space:]]' "$file"; then
    return 1
  fi
  if grep -qF -- "$MARKER" "$file"; then
    die "${file} contains the marker '${MARKER}', which is reserved for the release workflow."
  fi
  if is_rc "$tag"; then
    # shellcheck disable=SC2016 # backticks are Markdown, not a command substitution
    printf '> **Release candidate.** Notes may still change. Not published as `latest`.\n\n'
  fi
  printf '%s\n' "$(cat "$file")"
}

# Fallback head for a release candidate without curated notes: commits since
# the last stable tag. Pre-releases never get a CHANGELOG section.
commit_list_head() {
  local tag="$1" prev
  prev="$(git tag --list 'v*' | grep -Ev -- '-' | sort -V | tail -1 || true)"
  printf '## Pre-release build\n\n'
  # shellcheck disable=SC2016 # backticks are Markdown, not a command substitution
  printf 'Release candidate for the upcoming stable release. Not published as `latest`.\n\n'
  if [ -n "$prev" ]; then
    printf '**Commits since %s:**\n\n' "$prev"
    git log "${prev}..${tag}" --pretty='- %s (%h)'
  fi
}

# Artifact sections with @PLACEHOLDERS@, identical for every body.
artifact_sections() {
  local tag="$1"
  cat <<'EOF'
---

## Container image

```shell
docker pull ghcr.io/kj187/jarvis:@VERSION@
```

Digest: `@DIGEST@`

### Verify image signature (cosign)

```shell
cosign verify ghcr.io/kj187/jarvis@@DIGEST@ \
  --certificate-identity-regexp="https://github.com/kj187/jarvis/.*" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com"
```

### Verify build provenance (GitHub attestation)

```shell
gh attestation verify oci://ghcr.io/kj187/jarvis:@VERSION@ --repo kj187/jarvis
```

EOF
  if is_rc "$tag"; then
    cat <<'EOF'
## Helm chart

Release candidates don't publish a chart. To test this RC on Kubernetes, install the current chart with the RC image:

```shell
helm install jarvis oci://ghcr.io/kj187/charts/jarvis --version @CHART_VERSION@ --set image.tag=@VERSION@
```

EOF
  else
    cat <<'EOF'
## Helm chart

```shell
helm install jarvis oci://ghcr.io/kj187/charts/jarvis --version @CHART_VERSION@
```

Chart changes and breaking changes: [charts/jarvis/CHANGELOG.md](https://github.com/kj187/jarvis/blob/@TAG@/charts/jarvis/CHANGELOG.md)

### Verify chart signature (cosign)

```shell
cosign verify ghcr.io/kj187/charts/jarvis:@CHART_VERSION@ \
  --certificate-identity-regexp="https://github.com/kj187/jarvis/.*" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com"
```

EOF
  fi
  cat <<'EOF'
## SBOM

The SPDX SBOM is attached to this release (`sbom.spdx.json`) together with its keyless signature bundle (`sbom.spdx.json.sigstore.json`), and also embedded in the image manifest (`docker buildx imagetools inspect`).

```shell
cosign verify-blob sbom.spdx.json \
  --bundle sbom.spdx.json.sigstore.json \
  --certificate-identity-regexp="https://github.com/kj187/jarvis/.*" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com"
```
EOF
}

cmd_build() {
  [ "$#" -eq 3 ] || usage
  local tag="$1" digest="$2" chart_version="$3" head sections
  validate_tag "$tag"
  [[ "$digest" =~ $DIGEST_RE ]] || die "invalid image digest '${digest}'"
  [[ "$chart_version" =~ $CHART_VERSION_RE ]] || die "invalid chart version '${chart_version}'"

  if ! head="$(notes_head "$tag"; echo x)"; then
    exit 1 # notes_head already reported (marker in notes)
  fi
  head="${head%x}"
  if [ -z "$head" ]; then
    if is_rc "$tag"; then
      head="$(commit_list_head "$tag")"$'\n'
    else
      # Curated notes are mandatory for stable releases (they carry the
      # explicit Breaking Changes section); never fall back silently.
      die "$(notes_file "$tag") is missing or empty: every stable release needs curated notes (.agents/skills/release/SKILL.md)."
    fi
  fi

  sections="$(artifact_sections "$tag")"
  sections="${sections//@VERSION@/${tag#v}}"
  sections="${sections//@DIGEST@/${digest}}"
  sections="${sections//@CHART_VERSION@/${chart_version}}"
  sections="${sections//@TAG@/${tag}}"

  printf '%s\n%s\n\n%s\n' "$head" "$MARKER" "$sections"
}

cmd_refresh() {
  [ "$#" -eq 2 ] || usage
  local tag="$1" body_file="$2" head markers line
  validate_tag "$tag"
  [ -f "$body_file" ] || die "existing body file '${body_file}' not found"

  # The marker counts only as a whole line (a trailing CR from a body edited
  # in the web UI is tolerated); exactly one is required so that nothing is
  # ever replaced by guesswork.
  markers="$(awk -v m="$MARKER" '{ l = $0; sub(/\r$/, "", l); if (l == m) print NR }' "$body_file")"
  case "$(printf '%s' "$markers" | grep -c .)" in
    0) die "the existing release body has no '${MARKER}' marker (release created before the marker existed); refusing to guess where the notes end. Edit the release by hand." ;;
    1) line="$markers" ;;
    *) die "the existing release body has more than one '${MARKER}' marker; refusing to guess." ;;
  esac

  if ! head="$(notes_head "$tag"; echo x)"; then
    exit 1
  fi
  head="${head%x}"
  [ -n "$head" ] || die "$(notes_file "$tag") is missing or empty on this ref: nothing to refresh the notes from."

  printf '%s\n' "$head"
  tail -n "+${line}" "$body_file"
}

cmd_latest_flag() {
  [ "$#" -eq 3 ] || usage
  local prerelease="$1" latest="$2" tag="$3"
  validate_prerelease "$prerelease"
  validate_latest_tag "$latest"
  validate_tag "$tag"
  if [ "$prerelease" = true ]; then
    echo '--latest=false'
  elif [ "$latest" = none ]; then
    die "no latest release found, refusing to edit ${tag}: cannot tell whether it is the latest release."
  elif [ "$latest" = "$tag" ]; then
    echo '--latest'
  else
    echo '--latest=false'
  fi
}

cmd_verify_unchanged() {
  [ "$#" -eq 4 ] || usage
  validate_prerelease "$1"
  validate_latest_tag "$2"
  validate_prerelease "$3"
  validate_latest_tag "$4"
  if [ "$1" != "$3" ]; then
    die "isPrerelease changed from ${1} to ${3}. Check the release and fix it by hand."
  fi
  if [ "$2" != "$4" ]; then
    die "the latest release changed from ${2} to ${4}. Check the releases and fix it by hand."
  fi
}

[ "$#" -ge 1 ] || usage
command="$1"
shift
case "$command" in
  validate-tag) [ "$#" -eq 1 ] || usage; validate_tag "$1" ;;
  build) cmd_build "$@" ;;
  refresh) cmd_refresh "$@" ;;
  latest-flag) cmd_latest_flag "$@" ;;
  verify-unchanged) cmd_verify_unchanged "$@" ;;
  *) usage ;;
esac
