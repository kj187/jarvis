#!/usr/bin/env bash
# Resolves only a few of the alerts fired by fire-test-alerts.sh, so the three
# visual cases of the "Recently resolved" toggle can be checked side by side:
#   single  one ungrouped alert            KubeNodeNotReady
#   member  one alert out of a group       KubePodCrashLooping (1st of 3 pods)
#   group   every alert of a group         KubePodOOMKilled (all 3 pods)
#
# Posts each alert with endsAt in the past — Alertmanager marks them resolved
# immediately. Jarvis shows them for the resolved-buffer window after its next
# poll (JARVIS_RESOLVED_BUFFER_TTL, default 20 minutes).
#
# Usage: resolve-test-alerts-partial.sh [single|member|group ...]   (default: all three)

set -euo pipefail

AM="${ALERTMANAGER_URL:-http://localhost:9094}"
RUNBOOKS="https://runbooks.example.com/alerts"

ENDS_AT="$(date -u -d '1 minute ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
  || date -u -v-1M '+%Y-%m-%dT%H:%M:%SZ')"

post() {
  curl -sf -L -X POST "${AM}/api/v2/alerts" \
    -H "Content-Type: application/json" \
    -d "$1" >/dev/null
}

# oom <pod> — the labels must equal the ones fire-test-alerts.sh sends,
# otherwise Alertmanager treats it as a different alert.
oom() {
  printf '{"labels":{"alertname":"KubePodOOMKilled","severity":"warning","namespace":"prod","pod":"%s","container":"inference-server","cluster":"eu-west-1-prod","team":"ml","runbook":"%s/KubePodOOMKilled","test_suite":"jarvis"},"endsAt":"%s"}' \
    "$1" "$RUNBOOKS" "$ENDS_AT"
}

resolve_single() {
  printf '  single  KubeNodeNotReady ...'
  post '[{"labels":{"alertname":"KubeNodeNotReady","severity":"critical","node":"worker-node-03.eu-west-1.compute.internal","cluster":"eu-west-1-prod","team":"infrastructure","runbook":"'"${RUNBOOKS}"'/KubeNodeNotReady","test_suite":"jarvis"},"endsAt":"'"${ENDS_AT}"'"}]'
  echo " resolved"
}

resolve_member() {
  printf '  member  KubePodCrashLooping payment-api-7d9f6b8c4-xk2lp (1 of 3) ...'
  post '[{"labels":{"alertname":"KubePodCrashLooping","severity":"critical","namespace":"prod","pod":"payment-api-7d9f6b8c4-xk2lp","container":"payment-api","cluster":"eu-west-1-prod","team":"platform","runbook":"'"${RUNBOOKS}"'/KubePodCrashLooping","test_suite":"jarvis"},"endsAt":"'"${ENDS_AT}"'"}]'
  echo " resolved"
}

resolve_group() {
  printf '  group   KubePodOOMKilled, all 3 pods ...'
  post "[$(oom ml-inference-6c8d9f7b5-p9nrq),$(oom ml-inference-6c8d9f7b5-h4dtx),$(oom ml-inference-6c8d9f7b5-vw8kc)]"
  echo " resolved"
}

CASES=("$@")
[[ ${#CASES[@]} -eq 0 ]] && CASES=(single member group)

echo "==> Resolving a subset of the test alerts via ${AM} (endsAt: ${ENDS_AT})"
for c in "${CASES[@]}"; do
  case "$c" in
    single) resolve_single ;;
    member) resolve_member ;;
    group)  resolve_group ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "ERROR: unknown case: $c (use single, member, group)" >&2; exit 2 ;;
  esac
done
echo ""
echo "==> Done. Fire them again with 'make fixtures-create' to reset."
