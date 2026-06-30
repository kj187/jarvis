#!/usr/bin/env bash
# Expires all test silences created by create-test-silence.sh
# (identified by createdBy=fixtures).

set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required but not installed."; exit 1; }

AM="${ALERTMANAGER_URL:-http://localhost:9094}"

echo "==> Removing test silences (createdBy=fixtures) via ${AM}"

ids="$(curl -sf -L "${AM}/api/v2/silences" \
  | jq -r '.[] | select(.createdBy == "fixtures" and .status.state != "expired") | .id')"

if [ -z "$ids" ]; then
  echo "    No active test silences found."
  exit 0
fi

count=0
while IFS= read -r id; do
  [ -z "$id" ] && continue
  curl -sf -L -X DELETE "${AM}/api/v2/silence/${id}" >/dev/null
  echo "    expired ${id}"
  count=$((count + 1))
done <<< "$ids"

echo "==> Done. ${count} test silence(s) expired."
