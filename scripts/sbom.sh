#!/usr/bin/env bash
# Release SBOM: the image (Debian base packages, Go modules) plus the frontend
# production dependencies, which are compiled into the Go binary and so are
# invisible to a scan of the image alone.
#
# Usage:
#   scripts/sbom.sh build <image-ref> <out.spdx.json> [version]
#       Needs syft and pnpm. <image-ref> is anything syft accepts
#       (registry ref, docker:<name>, docker-archive:<file>).
#   scripts/sbom.sh merge <image.spdx.json> <frontend.spdx.json>   (SPDX on stdout)
#   scripts/sbom.sh check <sbom.spdx.json>
#       Fails unless the SBOM names one package from each source (react, a Go
#       module, a Debian package) and fewer than 10 % of the packages lack a
#       license (declared or concluded).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# One package per source: frontend bundle, Go binary, image base.
REQUIRED_PACKAGES=(react github.com/labstack/echo/v4 base-files)
MAX_UNLICENSED_PERCENT=10

usage() {
  sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  echo "usage: sbom.sh build|merge|check ..." >&2
  exit 2
}
die() { echo "error: $*" >&2; exit 1; }

need_file() { [ -r "$1" ] || die "cannot read '$1' (missing)"; }

cmd_merge() {
  [ "$#" -eq 2 ] || usage
  need_file "$1"
  need_file "$2"
  jq -s '
    .[0] as $img | .[1] as $fe
    | ($img.relationships // [] | map(select(.relationshipType == "DESCRIBES")) | first | .relatedSpdxElement) as $root
    | if $root == null then error("image SBOM has no DESCRIBES root") else . end
    | ($img.packages | map(.SPDXID)) as $have
    | ($fe.packages | map(select(.name != "jarvis-frontend" and (.SPDXID as $id | ($have | index($id)) == null)))) as $add
    | $img
    | .packages += $add
    | .relationships += ($add | map({spdxElementId: $root, relatedSpdxElement: .SPDXID, relationshipType: "CONTAINS"}))
  ' "$1" "$2" || die "merge failed: the image SBOM needs a DESCRIBES root and both inputs valid SPDX JSON"
}

cmd_check() {
  [ "$#" -eq 1 ] || usage
  need_file "$1"
  jq -e . "$1" >/dev/null 2>&1 || die "'$1' is not valid JSON (parse error)"
  local sbom="$1" name
  [ "$(jq '.packages | length' "$sbom")" -gt 0 ] || die "SBOM has an empty package list"
  for name in "${REQUIRED_PACKAGES[@]}"; do
    jq -e --arg n "$name" '.packages | any(.name == $n)' "$sbom" >/dev/null || die "SBOM lacks the package '${name}'"
  done
  local stats total unlicensed
  stats="$(jq -r '
    [.relationships // [] | .[] | select(.relationshipType == "DESCRIBES") | .relatedSpdxElement] as $roots
    | [.packages[] | select(.SPDXID as $id | ($roots | index($id)) == null)] as $pkgs
    | def none: . == null or . == "NOASSERTION" or . == "NONE";
      "\($pkgs | length) \($pkgs | map(select((.licenseDeclared | none) and (.licenseConcluded | none))) | length)"' "$sbom")"
  read -r total unlicensed <<<"$stats"
  if [ "$total" -eq 0 ] || [ $((unlicensed * 100)) -ge $((total * MAX_UNLICENSED_PERCENT)) ]; then
    die "${unlicensed} of ${total} packages have no license (NOASSERTION), limit is under ${MAX_UNLICENSED_PERCENT}%"
  fi
  echo "SBOM ok: ${total} packages, ${unlicensed} without license"
}

cmd_build() {
  [ "$#" -ge 2 ] && [ "$#" -le 3 ] || usage
  local image="$1" out="$2" version="${3:-unknown}" tmp
  for tool in syft pnpm jq; do
    command -v "$tool" >/dev/null || die "missing tool: $tool"
  done
  tmp="$(mktemp -d)"
  trap "rm -rf '$tmp'" EXIT # expanded now: tmp is local and gone when the trap fires

  # Production dependencies only, hoisted so syft reads real package.json
  # files (pnpm's symlinked store is invisible to it); package.json carries
  # the license. The lockfile stays out: it would add dev packages.
  mkdir "$tmp/frontend"
  cp "$ROOT/frontend/package.json" "$ROOT/frontend/pnpm-lock.yaml" "$ROOT/frontend/pnpm-workspace.yaml" "$tmp/frontend/"
  (cd "$tmp/frontend" && pnpm install --prod --frozen-lockfile --ignore-scripts --node-linker=hoisted >&2)

  syft "$image" --enrich golang -o "spdx-json=$tmp/image.json" >&2
  syft "dir:$tmp/frontend" --override-default-catalogers javascript-package-cataloger \
    --source-name jarvis-frontend --source-version "$version" -o "spdx-json=$tmp/frontend.json" >&2

  cmd_merge "$tmp/image.json" "$tmp/frontend.json" >"$out"
  cmd_check "$out"
}

[ "$#" -ge 1 ] || usage
cmd="$1"
shift
case "$cmd" in
  build) cmd_build "$@" ;;
  merge) cmd_merge "$@" ;;
  check) cmd_check "$@" ;;
  *) usage ;;
esac
