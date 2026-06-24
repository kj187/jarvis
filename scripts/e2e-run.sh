#!/usr/bin/env bash
# Orchestrates the isolated Jarvis E2E stack (compose.e2e.yml) for one auth mode.
#
# Usage:
#   scripts/e2e-run.sh test        <mode>            # functional suite for a mode
#   scripts/e2e-run.sh screenshots <mode>            # all screenshots for a mode
#   scripts/e2e-run.sh screenshot  <mode> <name>     # single screenshot (-g <name>)
#
#   <mode> = none | internal | oidc
#
# Brings the stack up fresh, waits until it is ready, runs Playwright inside the
# official playwright container, then always tears the stack down (ephemeral).

set -euo pipefail

ACTION="${1:?usage: e2e-run.sh <test|screenshots|screenshot> <mode> [name]}"
MODE="${2:?mode required: none|internal|oidc}"
NAME="${3:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Compose command is overridable so the same script works under podman (local)
# and docker (CI):  COMPOSE_CMD="docker compose" scripts/e2e-run.sh ...
read -ra COMPOSE <<< "${COMPOSE_CMD:-podman compose}"
COMPOSE+=(-f compose.e2e.yml)
JARVIS_HOST_URL="http://localhost:8085"
OIDC_HOST_URL="http://localhost:8086"

# ── Per-mode environment (consumed by compose variable substitution) ──────────
export E2E_AUTH_PROVIDER E2E_AUTH_MODE
export E2E_OIDC_ISSUER E2E_OIDC_CLIENT_ID E2E_OIDC_CLIENT_SECRET \
       E2E_OIDC_REDIRECT_URL E2E_OIDC_ADMIN_CLAIM E2E_OIDC_ADMIN_VALUE
export E2E_TEST_DIR E2E_SCREENSHOT_DIR

case "$MODE" in
  none)
    E2E_AUTH_PROVIDER=none;     E2E_AUTH_MODE=none ;;
  internal)
    E2E_AUTH_PROVIDER=internal; E2E_AUTH_MODE=write_protect ;;
  oidc)
    E2E_AUTH_PROVIDER=oidc;     E2E_AUTH_MODE=write_protect
    E2E_OIDC_ISSUER="http://e2e-mock-oidc:8080/default"
    E2E_OIDC_CLIENT_ID="jarvis-e2e"
    E2E_OIDC_CLIENT_SECRET="e2e-secret"
    E2E_OIDC_REDIRECT_URL="http://e2e-jarvis:8080/auth/oidc/callback"
    E2E_OIDC_ADMIN_CLAIM="groups"
    E2E_OIDC_ADMIN_VALUE="Administrator" ;;
  *)
    echo "ERROR: unknown mode '$MODE' (use none|internal|oidc)" >&2; exit 1 ;;
esac

E2E_TEST_DIR="./e2e/functional/${MODE}"
E2E_SCREENSHOT_DIR="./e2e/screenshots/${MODE}"

cleanup() { "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

wait_for() {
  local url="$1" name="$2" tries="${3:-60}"
  echo "    waiting for ${name} (${url})..."
  for _ in $(seq 1 "$tries"); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then echo "    ${name} ready"; return 0; fi
    sleep 1
  done
  echo "ERROR: ${name} did not become ready at ${url}" >&2
  "${COMPOSE[@]}" logs --tail 50 >&2 || true
  return 1
}

echo "==> [${MODE}] starting isolated e2e stack"
"${COMPOSE[@]}" down -v >/dev/null 2>&1 || true

if [ "$MODE" = "oidc" ]; then
  # Mock OIDC must be reachable before Jarvis starts (discovery happens at boot).
  "${COMPOSE[@]}" up -d e2e-mock-oidc
  wait_for "${OIDC_HOST_URL}/default/.well-known/openid-configuration" "mock-oidc"
fi

"${COMPOSE[@]}" up -d --build e2e-alertmanager e2e-jarvis
wait_for "${JARVIS_HOST_URL}/api/v1/status" "jarvis"

# ── Run Playwright in the official container, on the e2e network ──────────────
PW_SETUP='corepack enable && pnpm install --frozen-lockfile'

case "$ACTION" in
  test)
    echo "==> [${MODE}] running functional suite (${E2E_TEST_DIR})"
    "${COMPOSE[@]}" run --rm e2e-playwright \
      sh -c "${PW_SETUP} && pnpm exec playwright test --config playwright.e2e.config.ts"
    ;;
  screenshots)
    echo "==> [${MODE}] generating screenshots (${E2E_SCREENSHOT_DIR})"
    "${COMPOSE[@]}" run --rm e2e-playwright \
      sh -c "${PW_SETUP} && pnpm exec playwright test --config playwright.screenshots.e2e.config.ts"
    ;;
  screenshot)
    [ -n "$NAME" ] || { echo "ERROR: screenshot action needs a NAME" >&2; exit 1; }
    echo "==> [${MODE}] generating single screenshot '${NAME}'"
    "${COMPOSE[@]}" run --rm e2e-playwright \
      sh -c "${PW_SETUP} && pnpm exec playwright test --config playwright.screenshots.e2e.config.ts -g '${NAME}'"
    ;;
  *)
    echo "ERROR: unknown action '$ACTION'" >&2; exit 1 ;;
esac

echo "==> [${MODE}] done"
