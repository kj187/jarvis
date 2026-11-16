#!/usr/bin/env bash
# Tests for scripts/check-govulncheck.sh against throwaway govulncheck JSON
# streams and ignore files. Needs no network.
# Usage: scripts/test-check-govulncheck.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/check-govulncheck.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

passed=0
failed=0
pass() { passed=$((passed + 1)); echo "  ok   $1"; }
fail() { failed=$((failed + 1)); echo "  FAIL $1" >&2; [ -z "${2:-}" ] || echo "       $2" >&2; }

# accepts <name> <json> <ignore> [regex]: passes, and the output matches regex.
accepts() {
  if "$SCRIPT" "$2" "$3" >"$TMP/out" 2>&1 && { [ -z "${4:-}" ] || grep -qE -- "$4" "$TMP/out"; }; then
    pass "$1"
  else
    fail "$1" "output: $(head -c 400 "$TMP/out")"
  fi
}
# rejects <name> <json> <ignore> <regex>: fails and the output explains why.
rejects() {
  if ! "$SCRIPT" "$2" "$3" >"$TMP/out" 2>&1 && grep -qE -- "$4" "$TMP/out"; then
    pass "$1"
  else
    fail "$1" "output: $(head -c 400 "$TMP/out")"
  fi
}

# osv <id> <summary>: an advisory entry as govulncheck streams it.
osv() { printf '{"osv":{"id":"%s","summary":"%s"}}\n' "$1" "$2"; }
# called <id> <module> <fixed|null>: a finding whose trace reaches a function.
called() {
  printf '{"finding":{"osv":"%s","fixed_version":%s,"trace":[{"module":"%s","version":"v1.0.0","package":"%s","function":"F"},{"module":"github.com/kj187/jarvis/backend","function":"main"}]}}\n' \
    "$1" "$3" "$2" "$2"
}
# imported <id> <module>: a module/package-level finding, not called.
imported() {
  printf '{"finding":{"osv":"%s","fixed_version":null,"trace":[{"module":"%s","version":"v1.0.0","package":"%s"}]}}\n' "$1" "$2" "$2"
}

config='{"config":{"protocol_version":"v1.0.0","scanner_name":"govulncheck"}}'

{ echo "$config"; } >"$TMP/clean.json"
{ echo "$config"; osv GO-2026-0001 "Unreached bug"; imported GO-2026-0001 example.com/a; } >"$TMP/imported.json"
{ echo "$config"; osv GO-2026-0002 "Reached bug"; called GO-2026-0002 example.com/b '"v1.2.3"'; called GO-2026-0002 example.com/b '"v1.2.3"'; } >"$TMP/called.json"
{ echo "$config"; osv GO-2026-0002 "Reached bug"; called GO-2026-0002 example.com/b null;
  osv GO-2026-0003 "Other reached bug"; called GO-2026-0003 example.com/c '"v2.0.0"'; } >"$TMP/two.json"

: >"$TMP/empty.ignore"
cat >"$TMP/b.ignore" <<'TXT'
# comment lines and blank lines are skipped

GO-2026-0002  Jarvis never uses the affected middleware; no fixed version yet.
TXT
cat >"$TMP/stale.ignore" <<'TXT'
GO-2026-0002  still needed
GO-2026-9999  fixed upstream long ago
TXT
printf 'GO-2026-0002\n' >"$TMP/noreason.ignore"
printf 'CVE-2026-1  some reason\n' >"$TMP/badid.ignore"

echo "check-govulncheck.sh"
accepts "no findings pass" "$TMP/clean.json" "$TMP/empty.ignore"
accepts "imported-only findings pass (not reached)" "$TMP/imported.json" "$TMP/empty.ignore"
rejects "a called finding fails" "$TMP/called.json" "$TMP/empty.ignore" "GO-2026-0002.*Reached bug"
rejects "the failure names the fixed version" "$TMP/called.json" "$TMP/empty.ignore" "fixed in v1\.2\.3"
accepts "an ignored called finding passes and is reported" "$TMP/called.json" "$TMP/b.ignore" "ignored GO-2026-0002"
rejects "an ignore entry covers only its own ID" "$TMP/two.json" "$TMP/b.ignore" "GO-2026-0003"
rejects "no fixed version is reported as such" "$TMP/two.json" "$TMP/empty.ignore" "no fixed version"
accepts "a stale ignore entry only warns" "$TMP/called.json" "$TMP/stale.ignore" "GO-2026-9999.*no longer"
rejects "an ignore entry without a reason is refused" "$TMP/called.json" "$TMP/noreason.ignore" "reason"
rejects "an ignore entry that is not a GO- ID is refused" "$TMP/called.json" "$TMP/badid.ignore" "CVE-2026-1"
rejects "a missing JSON file fails" "$TMP/missing.json" "$TMP/empty.ignore" "not found"
printf 'not json\n' >"$TMP/broken.json"
rejects "unparsable JSON fails" "$TMP/broken.json" "$TMP/empty.ignore" "parse"
accepts "the repository's own ignore file is well-formed" "$TMP/clean.json" "$ROOT/backend/.govulncheck-ignore"

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
