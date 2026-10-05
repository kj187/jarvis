#!/usr/bin/env bash
# Tests for scripts/check-image-pins.sh. Runs against throwaway files, needs no
# network. Usage: scripts/test-check-image-pins.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/check-image-pins.sh"
D="sha256:$(printf 'a%.0s' $(seq 1 64))"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

passed=0
failed=0

pass() { passed=$((passed + 1)); echo "  ok   $1"; }
fail() { failed=$((failed + 1)); echo "  FAIL $1" >&2; [ -z "${2:-}" ] || echo "       $2" >&2; }

# accepts <name> <file>: the check passes for the file.
accepts() {
  if "$SCRIPT" "$2" >"$TMP/out" 2>&1; then pass "$1"; else fail "$1" "$(head -c 300 "$TMP/out")"; fi
}

# rejects <name> <file> <regex>: the check fails and its output matches the
# regex, so a missing script never counts as a correct rejection.
rejects() {
  if ! "$SCRIPT" "$2" >"$TMP/out" 2>&1 && grep -qE -- "$3" "$TMP/out"; then
    pass "$1"
  else
    fail "$1" "output: $(head -c 300 "$TMP/out")"
  fi
}

write() { printf '%s\n' "${@:2}" >"$TMP/$1"; }

write Containerfile.good \
  "FROM --platform=\$BUILDPLATFORM node:22-alpine@$D AS frontend" \
  "RUN npm install -g pnpm@11.9.0 && pnpm install --frozen-lockfile" \
  "FROM golang:1.26-alpine@$D AS backend" \
  "FROM gcr.io/distroless/static-debian12@$D" \
  "COPY --from=backend /out /out" \
  "FROM backend AS tests" \
  "FROM scratch"
accepts "digest-pinned images, stage references and scratch pass" "$TMP/Containerfile.good"

write Containerfile.nodigest "FROM golang:1.26-alpine"
rejects "FROM without digest fails and names file and line" "$TMP/Containerfile.nodigest" "Containerfile.nodigest:1.*golang:1.26-alpine"

write Containerfile.platform "FROM --platform=\$BUILDPLATFORM node:22-alpine AS frontend"
rejects "FROM with --platform but no digest fails" "$TMP/Containerfile.platform" "node:22-alpine"

write Containerfile.lower "from node:22-alpine"
rejects "lowercase from without digest fails" "$TMP/Containerfile.lower" "node:22-alpine"

write Containerfile.shortdigest "FROM node:22-alpine@sha256:abc123"
rejects "truncated digest fails" "$TMP/Containerfile.shortdigest" "node:22-alpine"

write Containerfile.second "FROM node:22-alpine@$D AS a" "FROM golang:1.26-alpine AS b"
rejects "only the unpinned second FROM is reported" "$TMP/Containerfile.second" "Containerfile.second:2"

write Containerfile.pnpm "RUN npm install -g pnpm && pnpm install"
rejects "unpinned pnpm install fails" "$TMP/Containerfile.pnpm" "pnpm"

write Containerfile.pnpmi "RUN npm i -g pnpm --prefix /usr/local"
rejects "unpinned pnpm via npm i fails" "$TMP/Containerfile.pnpmi" "pnpm"

write Containerfile.pnpmok "RUN npm install -g pnpm@11.9.0 --prefix /usr/local"
accepts "pinned pnpm passes" "$TMP/Containerfile.pnpmok"

write compose.fake.yml "    command: sh -c \"npm install -g pnpm --prefix /usr/local && pnpm dev\""
rejects "unpinned pnpm in a compose file fails" "$TMP/compose.fake.yml" "pnpm"

write compose.ok.yml "    image: node:22-alpine"
accepts "image: lines in compose files are not checked" "$TMP/compose.ok.yml"

if "$SCRIPT" >"$TMP/out" 2>&1; then pass "the repository itself passes"; else fail "the repository itself passes" "$(head -c 400 "$TMP/out")"; fi

echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
