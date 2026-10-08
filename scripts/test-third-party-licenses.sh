#!/usr/bin/env bash
# Tests for scripts/third-party-licenses-go.sh and third-party-licenses-npm.mjs
# against throwaway module and package directories. Needs no network and no
# Go toolchain. Usage: scripts/test-third-party-licenses.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GO_SCRIPT="$ROOT/scripts/third-party-licenses-go.sh"
NPM_SCRIPT="$ROOT/scripts/third-party-licenses-npm.mjs"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

passed=0
failed=0
pass() { passed=$((passed + 1)); echo "  ok   $1"; }
fail() { failed=$((failed + 1)); echo "  FAIL $1" >&2; [ -z "${2:-}" ] || echo "       $2" >&2; }

# ── Go modules ────────────────────────────────────────────────────────────────
mkdir -p "$TMP/mod-a" "$TMP/mod-b" "$TMP/mod-nolicense" "$TMP/mod-notice"
printf 'MIT License\n\nCopyright (c) 2026 Alpha\n' >"$TMP/mod-a/LICENSE"
printf 'BSD 3-Clause\n\nCopyright (c) 2026 Beta\n' >"$TMP/mod-b/LICENSE.txt"
printf 'Additional patent grant\n' >"$TMP/mod-b/PATENTS"
printf 'package x\n' >"$TMP/mod-nolicense/x.go"
printf 'Apache License\n\nCopyright 2026 Gamma\n' >"$TMP/mod-notice/COPYING"
printf 'Gamma product\nCopyright 2026 Gamma\n' >"$TMP/mod-notice/NOTICE"

go_input() { printf '%s\n' "$@"; }

out="$("$GO_SCRIPT" < <(go_input "example.com/alpha v1.0.0 $TMP/mod-a" "example.com/beta v2.1.0 $TMP/mod-b") 2>"$TMP/err")"
rc=$?
if [ $rc -eq 0 ] && grep -q 'example.com/alpha v1.0.0' <<<"$out" && grep -q 'Copyright (c) 2026 Alpha' <<<"$out" \
   && grep -q 'example.com/beta v2.1.0' <<<"$out" && grep -q 'Copyright (c) 2026 Beta' <<<"$out"; then
  pass "go: module name, version and license text are emitted"
else
  fail "go: module name, version and license text are emitted" "rc=$rc $(head -c 300 "$TMP/err")"
fi

if grep -q 'Additional patent grant' <<<"$out"; then pass "go: PATENTS file is included"; else fail "go: PATENTS file is included"; fi

out="$("$GO_SCRIPT" < <(go_input "example.com/gamma v3.0.0 $TMP/mod-notice") 2>&1)"
if grep -q 'Gamma product' <<<"$out" && grep -q 'Copyright 2026 Gamma' <<<"$out"; then
  pass "go: COPYING and NOTICE are both included"
else
  fail "go: COPYING and NOTICE are both included"
fi

if "$GO_SCRIPT" < <(go_input "example.com/alpha v1.0.0 $TMP/mod-a" "example.com/bare v0.1.0 $TMP/mod-nolicense") >"$TMP/out" 2>"$TMP/err"; then
  fail "go: a module without a license file fails the build"
elif grep -q 'example.com/bare' "$TMP/err"; then
  pass "go: a module without a license file fails the build and is named"
else
  fail "go: failure names the module" "$(head -c 300 "$TMP/err")"
fi

if "$GO_SCRIPT" < <(go_input "example.com/gone v1.0.0 ") >"$TMP/out" 2>"$TMP/err"; then
  fail "go: a module that is not downloaded (no directory) fails"
else
  pass "go: a module that is not downloaded (no directory) fails"
fi

if "$GO_SCRIPT" </dev/null >"$TMP/out" 2>"$TMP/err"; then
  fail "go: empty input fails (the go list command produced nothing)"
else
  pass "go: empty input fails (the go list command produced nothing)"
fi

# ── npm packages ──────────────────────────────────────────────────────────────
mkdir -p "$TMP/pkg-react" "$TMP/pkg-lucide" "$TMP/pkg-bare"
printf 'MIT License\n\nCopyright (c) Meta\n' >"$TMP/pkg-react/LICENSE"
printf 'ISC License\n\nCopyright (c) Lucide\n' >"$TMP/pkg-lucide/LICENSE.md"
printf '{}' >"$TMP/pkg-bare/package.json"

json_ok="{\"MIT\":[{\"name\":\"react\",\"versions\":[\"19.3.0\"],\"paths\":[\"$TMP/pkg-react\"],\"license\":\"MIT\"}],\"ISC\":[{\"name\":\"lucide-react\",\"versions\":[\"1.52.0\"],\"paths\":[\"$TMP/pkg-lucide\"],\"license\":\"ISC\"}]}"
out="$(node "$NPM_SCRIPT" <<<"$json_ok" 2>"$TMP/err")"
rc=$?
if [ $rc -eq 0 ] && grep -q 'react 19.3.0' <<<"$out" && grep -q 'Copyright (c) Meta' <<<"$out" \
   && grep -q 'lucide-react 1.52.0' <<<"$out" && grep -q 'Copyright (c) Lucide' <<<"$out"; then
  pass "npm: package name, version and license text are emitted"
else
  fail "npm: package name, version and license text are emitted" "rc=$rc $(head -c 300 "$TMP/err")"
fi

json_bad="{\"MIT\":[{\"name\":\"bare-pkg\",\"versions\":[\"1.0.0\"],\"paths\":[\"$TMP/pkg-bare\"],\"license\":\"MIT\"}]}"
if node "$NPM_SCRIPT" <<<"$json_bad" >"$TMP/out" 2>"$TMP/err"; then
  fail "npm: a package without a license file fails the build"
elif grep -q 'bare-pkg' "$TMP/err"; then
  pass "npm: a package without a license file fails the build and is named"
else
  fail "npm: failure names the package" "$(head -c 300 "$TMP/err")"
fi

if node "$NPM_SCRIPT" <<<'{}' >"$TMP/out" 2>"$TMP/err"; then
  fail "npm: an empty package list fails"
else
  pass "npm: an empty package list fails"
fi

echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
