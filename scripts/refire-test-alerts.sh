#!/usr/bin/env bash
# Resolves, then re-fires, all Kubernetes-themed test alerts — for manually
# testing anything that depends on a genuine new firing episode (occurrence
# count, the firing-pattern heatmap, claim auto-release on resolve).
#
# The 60-second grace period (Critical Invariant #1, AGENTS.md) is the
# constraint that matters here, NOT the poll interval: RecordStatusChange
# treats any re-fire within 60s of a recorded resolve as a poll-miss glitch
# — it deletes the resolved row and silently keeps the original firing row,
# by design, to avoid ghost-resolve entries. occurrenceCount and the
# firing-pattern heatmap only move on a firing that starts strictly more
# than 60s after the resolve was recorded. A plain
# `fixtures-remove && fixtures-create` run back to back (or with only a
# few seconds between) always lands inside that window and is silently
# absorbed — this is not a bug, it's the grace period working as intended.
#
# This script: resolves, forces an immediate poll (so the resolve is
# recorded promptly), waits well past 60s, then re-fires.

set -euo pipefail

JARVIS_URL="${JARVIS_URL:-http://localhost:8080}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GRACE_WAIT_SECONDS=70

echo "==> Step 1/4: resolving test alerts"
bash "${SCRIPT_DIR}/resolve-test-alerts.sh"

echo ""
echo "==> Step 2/4: forcing an immediate Jarvis poll (records the resolve promptly)"
curl -sf -X POST "${JARVIS_URL}/api/v1/poll" >/dev/null

echo "==> Step 3/4: waiting ${GRACE_WAIT_SECONDS}s — must clear the 60s grace period"
echo "    (a re-fire inside that window is treated as a poll-miss glitch and silently"
echo "    absorbed: the resolved row is deleted, the original firing row kept, no new"
echo "    occurrence — see Critical Invariant #1 in AGENTS.md)"
sleep "${GRACE_WAIT_SECONDS}"

echo "==> Step 4/4: re-firing test alerts (starts a new occurrence)"
bash "${SCRIPT_DIR}/fire-test-alerts.sh"

echo ""
echo "==> Done. occurrenceCount and the firing-pattern heatmap should now show"
echo "    a genuine new episode. Note: fire-test-alerts.sh's own poll happens on"
echo "    the next JARVIS_POLL_INTERVAL tick (or POST /api/v1/poll again)."
