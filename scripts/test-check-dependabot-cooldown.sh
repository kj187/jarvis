#!/usr/bin/env bash
# Tests for scripts/check-dependabot-cooldown.sh against throwaway dependabot
# files. Needs no network. Usage: scripts/test-check-dependabot-cooldown.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/check-dependabot-cooldown.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

passed=0
failed=0
pass() { passed=$((passed + 1)); echo "  ok   $1"; }
fail() { failed=$((failed + 1)); echo "  FAIL $1" >&2; [ -z "${2:-}" ] || echo "       $2" >&2; }

accepts() {
  if "$SCRIPT" "$2" >"$TMP/out" 2>&1; then pass "$1"; else fail "$1" "$(head -c 300 "$TMP/out")"; fi
}
# rejects <name> <file> <regex>: fails and the output explains why.
rejects() {
  if ! "$SCRIPT" "$2" >"$TMP/out" 2>&1 && grep -qE -- "$3" "$TMP/out"; then
    pass "$1"
  else
    fail "$1" "output: $(head -c 300 "$TMP/out")"
  fi
}

cat >"$TMP/good.yml" <<'YML'
version: 2
updates:
  - package-ecosystem: gomod
    directory: /backend
    schedule:
      interval: daily
    cooldown:
      default-days: 7
    open-pull-requests-limit: 5

  - package-ecosystem: npm
    directory: /frontend
    schedule:
      interval: daily
    groups:
      minor-patch:
        patterns:
          - "*"
    cooldown:
      default-days: 10
YML
accepts "every ecosystem has a cooldown of at least 7 days" "$TMP/good.yml"

sed 's/default-days: 7/default-days: 3/' "$TMP/good.yml" >"$TMP/short.yml"
rejects "a cooldown below 7 days fails" "$TMP/short.yml" "gomod.*3.*7"

# Drop the whole cooldown block of the gomod entry.
awk 'BEGIN{skip=0} /cooldown:/ && !done {skip=2; done=1} skip>0 {skip--; next} {print}' "$TMP/good.yml" >"$TMP/missing.yml"
rejects "an ecosystem without a cooldown fails" "$TMP/missing.yml" "gomod.*no cooldown"

printf 'version: 2\nupdates: []\n' >"$TMP/empty.yml"
rejects "a file without update entries fails" "$TMP/empty.yml" "no update entries"

if "$SCRIPT" "$TMP/nonexistent.yml" >"$TMP/out" 2>&1; then fail "a missing file fails"; else pass "a missing file fails"; fi

# The real file in the repo satisfies the rule.
accepts "the repository's dependabot.yml passes" "$ROOT/.github/dependabot.yml"

echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
