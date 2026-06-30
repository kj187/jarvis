#!/usr/bin/env bash
# Creates a silence directly in Alertmanager whose regex matcher value contains
# literal backslash escapes (\/ and \-) — the kind some external tools / older
# setups produce, which Jarvis itself never generates.
#
# Use this to reproduce / verify the "Recreate silence" backslash bug:
#   1. make fixtures-create        # fires SpecialCharLabelAlert (secret_path=v1/b2b/cert/web-tuadev)
#   2. make fixtures-silence       # this script — creates the escaped silence
#   3. In Jarvis open the silence and click "Recreate":
#        - the secret_path chip must read  v1/b2b/cert/web-tuadev  (no backslashes)
#        - it must still match 1 affected alert
#
# Clean up with: make fixtures-unsilence  (resolve-test-silence.sh)

set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required but not installed."; exit 1; }

AM="${ALERTMANAGER_URL:-http://localhost:9094}"

STARTS_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
ENDS_AT="2099-12-31T23:59:59.000Z"

# Regex matcher value with literal backslashes before / and - (as stored by some
# external silence creators). The real label value is: v1/b2b/cert/web-tuadev
ESCAPED_PATH='v1\/b2b\/cert\/web\-tuadev'

echo "==> Creating escaped test silence in ${AM}"
echo "    matcher: secret_path =~ ${ESCAPED_PATH}"

payload="$(jq -n \
  --arg s "$STARTS_AT" \
  --arg e "$ENDS_AT" \
  --arg v "$ESCAPED_PATH" \
  '{
    matchers: [
      { name: "secret_path", value: $v, isRegex: true, isEqual: true },
      { name: "test_suite",  value: "jarvis", isRegex: false, isEqual: true }
    ],
    startsAt: $s,
    endsAt: $e,
    createdBy: "fixtures",
    comment: "Recreate-bug repro: regex matcher with literal \\/ and \\- escapes"
  }')"

resp="$(curl -sf -L -X POST "${AM}/api/v2/silences" \
  -H "Content-Type: application/json" \
  -d "$payload")"

id="$(printf '%s' "$resp" | jq -r '.silenceID // empty')"
if [ -z "$id" ]; then
  echo "ERROR: Alertmanager did not return a silenceID. Response: $resp" >&2
  exit 1
fi

echo "    OK — silenceID: ${id}"
echo ""
echo "==> Done. Open Jarvis, find the silence, click 'Recreate' and verify the"
echo "    secret_path chip has NO backslashes and matches 1 alert."
echo "    Remove it again with: make fixtures-unsilence"
