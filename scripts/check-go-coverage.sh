#!/usr/bin/env bash
# Fails when a backend package's statement coverage is below its floor.
#
# Usage: scripts/check-go-coverage.sh [coverage.out] [floors-file]
#   coverage.out  Go coverage profile (default backend/coverage.out)
#   floors-file   one "<package under internal/> <min percent>" per line,
#                 '#' comments and blank lines ignored (default backend/coverage-floors.txt)
#
# Coverage per package is covered statements / all statements from the profile,
# the same figure `go test -cover` prints. Floors are a ratchet against
# regressions in packages that carry security behaviour, not a quality target:
# raise a floor when coverage has grown, never lower one to make CI pass.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${1:-$ROOT/backend/coverage.out}"
FLOORS="${2:-$ROOT/backend/coverage-floors.txt}"

[ -f "$PROFILE" ] || { echo "coverage profile not found: $PROFILE" >&2; exit 1; }
[ -f "$FLOORS" ] || { echo "floors file not found: $FLOORS" >&2; exit 1; }

# Per-package "covered total" statement counts, keyed by the path after /internal/.
awk '
  NR == 1 && /^mode:/ { next }
  {
    split($1, loc, ":")
    file = loc[1]
    if (!match(file, /\/internal\/.*\//)) next
    pkg = substr(file, RSTART + 10, RLENGTH - 11)
    stmts = $2; count = $3
    total[pkg] += stmts
    if (count > 0) covered[pkg] += stmts
  }
  END { for (p in total) printf "%s %d %d\n", p, covered[p] + 0, total[p] }
' "$PROFILE" >"${TMPDIR:-/tmp}/go-cov-$$.txt"
trap 'rm -f "${TMPDIR:-/tmp}/go-cov-$$.txt"' EXIT
STATS="${TMPDIR:-/tmp}/go-cov-$$.txt"

status=0
while read -r pkg floor extra; do
  case "$pkg" in ''|'#'*) continue ;; esac
  if [ -z "${floor:-}" ] || [ -n "${extra:-}" ] || ! [[ "$floor" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    echo "malformed floor line: '$pkg ${floor:-} ${extra:-}' (expected '<package> <percent>')" >&2
    status=1
    continue
  fi
  line="$(awk -v p="$pkg" '$1 == p { print $2, $3 }' "$STATS")"
  if [ -z "$line" ]; then
    echo "FAIL $pkg: no coverage data in the profile (package renamed, or its tests did not run)" >&2
    status=1
    continue
  fi
  read -r covered total <<<"$line"
  pct="$(awk -v c="$covered" -v t="$total" 'BEGIN { printf "%.1f", (t == 0 ? 0 : 100 * c / t) }')"
  if awk -v a="$pct" -v b="$floor" 'BEGIN { exit !(a + 0 >= b + 0) }'; then
    echo "ok   $pkg: $pct% (floor $floor%)"
  else
    echo "FAIL $pkg: $pct% is below the floor of $floor%" >&2
    status=1
  fi
done <"$FLOORS"

exit $status
