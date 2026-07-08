#!/usr/bin/env bash
# Resolves, then re-fires, all Kubernetes-themed test alerts — for manually
# testing anything that depends on a genuine new firing episode (occurrence
# count, the firing-pattern heatmap, claim auto-release on resolve).
#
# A bare `make fixtures-remove && make fixtures-create` can outrace the
# recorder's poll interval: Jarvis is snapshot-diffing (compares this poll's
# alert list against the last one), not event-log based, so a resolve+refire
# cycle that completes faster than one JARVIS_POLL_INTERVAL is invisible to
# it — the alert never appears "gone" in any snapshot, so no resolved event
# is recorded and no new firing episode starts (occurrenceCount and the
# heatmap don't move, even though Alertmanager's own startsAt did change).
# This script forces an immediate poll via POST /api/v1/poll and waits for
# it to land before re-firing, so the resolved state is always observed.

set -euo pipefail

JARVIS_URL="${JARVIS_URL:-http://localhost:8080}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Step 1/3: resolving test alerts"
bash "${SCRIPT_DIR}/resolve-test-alerts.sh"

echo ""
echo "==> Step 2/3: forcing an immediate Jarvis poll (so the resolve is observed)"
curl -sf -X POST "${JARVIS_URL}/api/v1/poll" >/dev/null
sleep 3

echo "==> Step 3/3: re-firing test alerts (starts a new occurrence)"
bash "${SCRIPT_DIR}/fire-test-alerts.sh"

echo ""
echo "==> Done. occurrenceCount and the firing-pattern heatmap should now show"
echo "    a genuine new episode. Note: fire-test-alerts.sh's own poll happens on"
echo "    the next JARVIS_POLL_INTERVAL tick (or POST /api/v1/poll again)."
