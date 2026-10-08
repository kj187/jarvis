#!/usr/bin/env bash
# Tests for scripts/check-go-coverage.sh against hand-written coverage profiles
# and floor files. Needs no Go toolchain or network.
# Usage: scripts/test-check-go-coverage.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/check-go-coverage.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

passed=0
failed=0
pass() { passed=$((passed + 1)); echo "  ok   $1"; }
fail() { failed=$((failed + 1)); echo "  FAIL $1" >&2; [ -z "${2:-}" ] || echo "       $2" >&2; }

M=github.com/kj187/jarvis/backend/internal

# A profile where auth has 8 of 10 statements covered (80 %) and db 1 of 4 (25 %).
cat >"$TMP/profile.out" <<PROF
mode: atomic
$M/auth/jwt.go:10.1,12.2 5 1
$M/auth/jwt.go:14.1,16.2 3 1
$M/auth/jwt.go:18.1,20.2 2 0
$M/db/db.go:5.1,6.2 1 3
$M/db/db.go:8.1,9.2 3 0
PROF

floors() { printf '%s\n' "$@" >"$TMP/floors.txt"; }

# accepts <name> <floor lines...>
accepts() {
  local name=$1; shift
  floors "$@"
  if "$SCRIPT" "$TMP/profile.out" "$TMP/floors.txt" >"$TMP/out" 2>&1; then pass "$name"; else fail "$name" "$(head -c 300 "$TMP/out")"; fi
}

# rejects <name> <regex> <floor lines...>: exit 1 and the output explains why.
rejects() {
  local name=$1 re=$2; shift 2
  floors "$@"
  if ! "$SCRIPT" "$TMP/profile.out" "$TMP/floors.txt" >"$TMP/out" 2>&1 && grep -qE -- "$re" "$TMP/out"; then
    pass "$name"
  else
    fail "$name" "output: $(head -c 300 "$TMP/out")"
  fi
}

accepts "package above its floor passes"            "auth 70"
accepts "package exactly at its floor passes"        "auth 80.0"
accepts "comments and blank lines are ignored"       "# a comment" "" "auth 70"
rejects "package below its floor fails"              "auth.*80\.0.*85" "auth 85"
rejects "second package below its floor fails"       "db.*25\.0.*60"   "auth 70" "db 60"
rejects "package missing from the profile fails"     "nosuchpkg.*no coverage data" "nosuchpkg 10"
rejects "malformed floor line fails"                 "malformed"       "auth"
rejects "non-numeric floor fails"                    "malformed"       "auth seventy"

if "$SCRIPT" "$TMP/missing.out" "$TMP/floors.txt" >"$TMP/out" 2>&1; then
  fail "missing profile file fails"
else
  pass "missing profile file fails"
fi

echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
