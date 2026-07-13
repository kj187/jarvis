#!/usr/bin/env bash
# Resolves, then re-fires, all Kubernetes-themed test alerts — for manually
# testing anything that depends on a genuine new firing episode (occurrence
# count, the firing-pattern heatmap, claim auto-release on resolve).
#
# The grace period (Critical Invariant #1, AGENTS.md) is the constraint
# that matters here: RecordStatusChange treats any re-fire within the grace
# period of a recorded resolve as a poll-miss glitch — it deletes the
# resolved row and silently keeps the original firing row, by design, to
# avoid ghost-resolve entries. occurrenceCount and the firing-pattern
# heatmap only move on a firing that starts strictly after the grace period
# elapses. A plain `fixtures-remove && fixtures-create` run back to back (or
# with only a few seconds between) always lands inside that window and is
# silently absorbed — this is not a bug, it's the grace period working as
# intended.
#
# GRACE_WAIT_SECONDS below assumes the default grace period (60s), which in
# turn assumes the default JARVIS_POLL_INTERVAL (15s) — the grace period is
# max(60s, 2×JARVIS_POLL_INTERVAL) (see AGENTS.md Critical Invariant #1), so
# a deployment with a poll interval > 30s needs a longer wait here too.
#
# This script: resolves, forces an immediate poll (so the resolve is
# recorded promptly), waits well past the grace period, then re-fires.

set -euo pipefail

JARVIS_URL="${JARVIS_URL:-http://localhost:8080}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GRACE_WAIT_SECONDS=70

echo "==> Step 1/4: resolving test alerts"
bash "${SCRIPT_DIR}/resolve-test-alerts.sh"

echo ""
echo "==> Step 2/4: forcing an immediate Jarvis poll (records the resolve promptly)"
curl -sf -X POST "${JARVIS_URL}/api/v1/poll" >/dev/null

echo "==> Step 3/4: waiting ${GRACE_WAIT_SECONDS}s — must clear the grace period (default 60s)"
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
