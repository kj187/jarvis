#!/usr/bin/env bash
# Supply-chain pin check for container builds.
#
# Usage: scripts/check-image-pins.sh [file...]
#   Without arguments it checks Containerfile*, compose*.yml and the Makefile
#   in the repository root.
#
# Rules:
#   1. Every FROM line in a Containerfile* references its image with a full
#      @sha256:<64 hex> digest (Dependabot's docker ecosystem keeps it fresh).
#      `scratch` and references to an earlier build stage are exempt.
#   2. pnpm is never installed unpinned: `npm install -g pnpm` needs an
#      explicit @<version> (any file given, compose and Makefile included).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$#" -gt 0 ]; then
  files=("$@")
else
  files=()
  for f in "$ROOT"/Containerfile* "$ROOT"/compose*.yml "$ROOT/Makefile"; do
    [ -f "$f" ] && files+=("$f")
  done
fi

errors=0
fail() {
  echo "  [Image pins] ✖ $*" >&2
  errors=$((errors + 1))
}

for f in "${files[@]}"; do
  rel="${f#"$ROOT"/}"

  if [[ "$(basename "$f")" == Containerfile* ]]; then
    stages=" "
    n=0
    while IFS= read -r line || [ -n "$line" ]; do
      n=$((n + 1))
      read -ra words <<<"$line"
      [ "${#words[@]}" -gt 0 ] || continue
      kw="$(printf '%s' "${words[0]}" | tr '[:upper:]' '[:lower:]')"
      [ "$kw" = "from" ] || continue

      image=""
      for ((i = 1; i < ${#words[@]}; i++)); do
        case "${words[i]}" in
          --*) ;;
          *) image="${words[i]}"; break ;;
        esac
      done

      for ((i = 1; i < ${#words[@]}; i++)); do
        w="$(printf '%s' "${words[i]}" | tr '[:upper:]' '[:lower:]')"
        if [ "$w" = "as" ] && [ $((i + 1)) -lt ${#words[@]} ]; then
          stage="${words[i + 1]}"
          break
        fi
        stage=""
      done

      if [ "$image" != "scratch" ] && [[ "$stages" != *" $image "* ]] \
         && ! [[ "$image" =~ @sha256:[0-9a-f]{64}$ ]]; then
        fail "$rel:$n: FROM $image has no @sha256 digest"
      fi
      [ -z "${stage:-}" ] || stages="$stages$stage "
      stage=""
    done <"$f"
  fi

  n=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    if [[ "$line" =~ npm[[:space:]]+(install|i)[[:space:]]+([^&;|]*[[:space:]])?pnpm([[:space:]]|\"|\'|$) ]]; then
      fail "$rel:$n: pnpm is installed without a pinned version (use pnpm@<version>)"
    fi
  done <"$f"
done

if [ "$errors" -gt 0 ]; then
  echo "    Pin the image with 'image:tag@sha256:<digest>' (crane digest <image:tag>) and pnpm with an explicit version." >&2
  exit 1
fi
echo "  [Image pins] OK"
