#!/usr/bin/env bash
# Every update entry in .github/dependabot.yml must set a cooldown of at least
# MIN_DAYS (default-days), so a freshly published (possibly compromised)
# release is not proposed the day it appears. Dependabot's security updates
# are exempt from the cooldown by design.
#
# Usage: scripts/check-dependabot-cooldown.sh [dependabot.yml]

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="${1:-$ROOT/.github/dependabot.yml}"
MIN_DAYS=7

[ -f "$FILE" ] || { echo "dependabot file not found: $FILE" >&2; exit 1; }

# One line per entry: "<ecosystem> <directory> <default-days or ->".
entries="$(awk '
  function flush() { if (eco != "") printf "%s %s %s\n", eco, dir, (days == "" ? "-" : days) }
  /^  - package-ecosystem:/ { flush(); eco = $3; dir = ""; days = ""; incool = 0; next }
  eco != "" && /^    directory:/ { dir = $2; next }
  eco != "" && /^    cooldown:/ { incool = 1; next }
  incool && /^      default-days:/ { days = $2; next }
  /^    [a-z-]+:/ { incool = 0 }
  END { flush() }
' "$FILE")"

if [ -z "$entries" ]; then
  echo "dependabot: no update entries found in $FILE" >&2
  exit 1
fi

status=0
while read -r eco dir days; do
  if [ "$days" = "-" ]; then
    echo "FAIL $eco ($dir): no cooldown with default-days (need at least $MIN_DAYS)" >&2
    status=1
  elif ! [[ "$days" =~ ^[0-9]+$ ]] || [ "$days" -lt "$MIN_DAYS" ]; then
    echo "FAIL $eco ($dir): cooldown default-days is $days, need at least $MIN_DAYS" >&2
    status=1
  else
    echo "ok   $eco ($dir): cooldown $days days"
  fi
done <<<"$entries"

exit $status
