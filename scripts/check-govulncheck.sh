#!/usr/bin/env bash
# Gate on govulncheck's JSON output: fail on every vulnerability the code
# reaches (a finding whose trace ends in a function), except the IDs listed in
# the ignore file. Each ignore entry is "<GO-ID> <reason>"; the reason is
# mandatory, so every exception carries its justification where it lives.
# Imported-but-unreached findings never fail, matching govulncheck's own exit
# code in text mode. An ignore entry that no longer matches a reached finding
# only warns, so an upstream fix does not turn CI red — remove it then.
#
# Usage: govulncheck -format json ./... > vuln.json
#        scripts/check-govulncheck.sh vuln.json [backend/.govulncheck-ignore]

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JSON="${1:?usage: check-govulncheck.sh <govulncheck.json> [ignore-file]}"
IGNORE="${2:-$ROOT/backend/.govulncheck-ignore}"

[ -f "$JSON" ] || { echo "govulncheck JSON not found: $JSON" >&2; exit 1; }
[ -f "$IGNORE" ] || { echo "ignore file not found: $IGNORE" >&2; exit 1; }

# Ignore file: one "<GO-ID> <reason>" per line; '#' comments and blanks skipped.
ignored=""
bad=0
set -f # word-split each line below without glob expansion
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%%#*}"
  # shellcheck disable=SC2086
  set -- $line
  [ $# -eq 0 ] && continue
  if ! [[ "$1" =~ ^GO-[0-9]{4}-[0-9]+$ ]]; then
    echo "$IGNORE: '$1' is not a Go vulnerability ID (GO-YYYY-NNNN)" >&2
    bad=1
  elif [ $# -lt 2 ]; then
    echo "$IGNORE: $1 has no reason — every exception must say why it is safe" >&2
    bad=1
  else
    ignored="$ignored $1"
  fi
done <"$IGNORE"
[ "$bad" -eq 0 ] || exit 1

# One line per reached advisory: "<id>\t<module>\t<fixed or ->\t<summary>".
if ! reached="$(jq -rs '
    (map(select(.osv) | {key: .osv.id, value: (.osv.summary // "")}) | from_entries) as $sum
    | map(select(.finding and (.finding.trace[0].function // "") != "") | .finding)
    | group_by(.osv)
    | map(.[0] | [.osv, .trace[0].module, (.fixed_version // "-"), ($sum[.osv] // "")] | @tsv)
    | .[]' "$JSON" 2>/dev/null)"; then
  echo "could not parse govulncheck JSON in $JSON" >&2
  exit 1
fi

status=0
seen=""
while IFS=$'\t' read -r id module fixed summary; do
  [ -n "$id" ] || continue
  seen="$seen $id"
  if [[ " $ignored " == *" $id "* ]]; then
    echo "ignored $id ($module): $summary — see $IGNORE"
    continue
  fi
  if [ "$fixed" = "-" ]; then fix="no fixed version"; else fix="fixed in $fixed"; fi
  echo "::error::$id in $module ($fix): $summary — https://pkg.go.dev/vuln/$id"
  status=1
done <<<"$reached"

for id in $ignored; do
  if [[ " $seen " != *" $id "* ]]; then
    echo "::warning::$id in $IGNORE no longer matches a reached finding — remove the entry"
  fi
done

[ "$status" -eq 0 ] && echo "govulncheck: no unignored reached vulnerabilities"
exit "$status"
