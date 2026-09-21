#!/usr/bin/env bash
# Full local verification of the current working tree — the single answer to
# "is this branch clean and does Jarvis still work?".
#
# Usage:
#   make verify              # everything, including the production image
#   make verify FAST=1       # skip the production image build + smoke test
#   scripts/verify.sh        # same, called directly
#
# Runs every gate CI runs, plus the two things CI covers only partly or not
# at all locally:
#   - the PostgreSQL-backed tests (leader election, WS fanout, history):
#     `go test` skips them silently when JARVIS_TEST_POSTGRES_DSN is unset,
#     so a green local run says nothing about the HA path. This script
#     starts a throwaway PostgreSQL and sets the DSN.
#   - the production image (`//go:build prod` + embed.FS, distroless): built
#     in CI only at release time. This script builds it and boots it.
#
# Reporting rule: a step that could not run is SKIPPED, never PASSED. Silent
# skips are what make a green run misleading, so they are listed separately
# and downgrade the final verdict to INCOMPLETE.
#
# Exit codes:  0 = VERIFIED   1 = FAILED (a step failed)   2 = INCOMPLETE (steps skipped)
#
# Container engine is overridable so this works under podman (local) and
# docker: CONTAINER_CMD="docker" COMPOSE_CMD="docker compose" scripts/verify.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CONTAINER_CMD="${CONTAINER_CMD:-podman}"
read -ra COMPOSE_DEPS <<< "${COMPOSE_CMD:-podman compose}"
COMPOSE_DEPS+=(-f compose.dev-dependencies.yml)

FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-jarvis_frontend_1}"
PG_DSN="postgres://jarvis:jarvis@localhost:5432/jarvis?sslmode=disable"
SMOKE_CONTAINER="jarvis_verify_smoke"
SMOKE_IMAGE="localhost/jarvis:verify"
SMOKE_PORT="${SMOKE_PORT:-18080}"

PASSED=(); FAILED=(); SKIPPED=()
STARTED_PG=0; STARTED_AM=0

# ── Output helpers ────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_BAD=$'\033[31m'; C_SKIP=$'\033[33m'; C_HEAD=$'\033[36m'; C_OFF=$'\033[0m'
else
  C_OK=""; C_BAD=""; C_SKIP=""; C_HEAD=""; C_OFF=""
fi

section() { printf '\n%s── %s %s\n' "$C_HEAD" "$1" "$(printf '─%.0s' $(seq 1 $((60 - ${#1}))))$C_OFF"; }
pass()    { PASSED+=("$1");  printf '  %s✔%s %s\n' "$C_OK" "$C_OFF" "$1"; }
fail()    { FAILED+=("$1");  printf '  %s✖%s %s\n' "$C_BAD" "$C_OFF" "$1"; }
skip()    { SKIPPED+=("$1 — $2"); printf '  %s•%s %s %s(skipped: %s)%s\n' "$C_SKIP" "$C_OFF" "$1" "$C_SKIP" "$2" "$C_OFF"; }

# Run a step, capture its output, show it only on failure.
step() {
  local name="$1"; shift
  local log; log="$(mktemp)"
  [ -t 1 ] && printf '  … %s\r' "$name"
  if "$@" >"$log" 2>&1; then
    pass "$name"
  else
    fail "$name"
    sed 's/^/      /' "$log" | tail -30 >&2
  fi
  rm -f "$log"
}

have() { command -v "$1" >/dev/null 2>&1; }

# Portable "run this in backend/" — BSD and GNU `env -C` are not equivalent.
in_backend() { ( cd "$ROOT/backend" && "$@" ); }

# ── Cleanup ───────────────────────────────────────────────────────────────────
cleanup() {
  $CONTAINER_CMD rm -f "$SMOKE_CONTAINER" >/dev/null 2>&1 || true
  $CONTAINER_CMD rmi "$SMOKE_IMAGE"       >/dev/null 2>&1 || true
  [ "$STARTED_PG" = "1" ] && "${COMPOSE_DEPS[@]}" stop test-postgres     >/dev/null 2>&1
  [ "$STARTED_AM" = "1" ] && "${COMPOSE_DEPS[@]}" stop test-alertmanager >/dev/null 2>&1
  return 0
}
trap cleanup EXIT INT TERM

# ── Test dependencies ─────────────────────────────────────────────────────────
section "Test dependencies"

pg_ready() { $CONTAINER_CMD exec jarvis_test_postgres pg_isready -U jarvis >/dev/null 2>&1; }

if ! have "$CONTAINER_CMD"; then
  skip "PostgreSQL test database" "$CONTAINER_CMD not installed"
elif pg_ready; then
  pass "PostgreSQL already running"
else
  printf '  … starting PostgreSQL\r'
  $CONTAINER_CMD network create jarvis_default >/dev/null 2>&1 || true
  if "${COMPOSE_DEPS[@]}" up -d test-postgres >/dev/null 2>&1; then
    STARTED_PG=1
    for _ in $(seq 1 30); do pg_ready && break; sleep 1; done
    if pg_ready; then pass "PostgreSQL started"; else fail "PostgreSQL did not become ready"; fi
  else
    fail "PostgreSQL could not be started"
  fi
fi

if pg_ready 2>/dev/null; then
  export JARVIS_TEST_POSTGRES_DSN="$PG_DSN"
else
  skip "PostgreSQL-backed tests (leader, fanout, history, db)" "no test database"
fi

# ── Backend ───────────────────────────────────────────────────────────────────
section "Backend"

# A local toolchain older than the one CI pins makes govulncheck report
# standard-library CVEs that the released image never has (the Containerfile
# tracks golang:1.26-alpine). Checking it explicitly turns a confusing
# govulncheck failure into an obvious "your Go is behind".
toolchain_matches_ci() {
  local want have_v
  want="$(grep -oE "go-version: '[0-9.]+'" .github/workflows/ci.yml | head -1 | grep -oE "[0-9.]+")"
  have_v="$(go env GOVERSION 2>/dev/null | sed 's/^go//')"
  [ -n "$want" ] && [ -n "$have_v" ] || return 0
  if [ "$(printf '%s\n%s\n' "$want" "$have_v" | sort -V | tail -1)" != "$have_v" ]; then
    echo "local Go is $have_v, CI pins $want — update it, or govulncheck below reports"
    echo "standard-library CVEs that the released image does not have."
    return 1
  fi
}

if have go; then
  step "Go toolchain at least CI's version" toolchain_matches_ci
  step "go test -race ./... (incl. PostgreSQL when available)" \
    in_backend go test -race ./...
else
  skip "backend tests" "go not installed"
fi

if have golangci-lint; then
  # Also the formatting gate: .golangci.yml enables the gofmt formatter.
  step "golangci-lint (incl. gosec, gofmt)" in_backend golangci-lint run ./...
else
  skip "golangci-lint (incl. gosec, gofmt)" "golangci-lint not installed"
fi

if have govulncheck; then
  step "govulncheck" in_backend govulncheck ./...
else
  skip "govulncheck" "govulncheck not installed"
fi

# ── Frontend ──────────────────────────────────────────────────────────────────
section "Frontend"

fe() { $CONTAINER_CMD exec "$FRONTEND_CONTAINER" sh -c "cd /app && $1"; }

if have "$CONTAINER_CMD" && $CONTAINER_CMD exec "$FRONTEND_CONTAINER" true >/dev/null 2>&1; then
  step "unit tests + coverage gate" fe "pnpm test:unit:coverage"
  step "build (TypeScript strict)"  fe "pnpm build"
  step "pnpm audit"                 fe "pnpm audit --audit-level=high"
else
  skip "frontend tests, build and audit" "dev container '$FRONTEND_CONTAINER' not running — run 'make up'"
fi

# ── Helm chart ────────────────────────────────────────────────────────────────
section "Helm chart"

if have helm; then
  step "helm lint" helm lint charts/jarvis/
  if helm plugin list 2>/dev/null | grep -q unittest; then
    step "helm unittest" helm unittest charts/jarvis/
  else
    skip "helm unittest" "helm-unittest plugin not installed"
  fi
else
  skip "helm lint and unittest" "helm not installed"
fi

# ── Repository gates ──────────────────────────────────────────────────────────
section "Repository gates"

step "agent context" scripts/check-agent-context.sh
step "release body script" scripts/test-release-body.sh

changelog_check() {
  local base; base="$(git merge-base origin/main HEAD 2>/dev/null)" || return 0
  git diff --name-only "$base" HEAD | scripts/check-changelogs.sh
}
step "changelogs" changelog_check

if have node; then
  step "design tokens in sync" node scripts/design-tokens.mjs --check
  step "no design drift"       node scripts/check-design-drift.mjs
else
  skip "design token and drift checks" "node not installed"
fi

# ── Production image ──────────────────────────────────────────────────────────
section "Production image"

smoke_test() {
  $CONTAINER_CMD rm -f "$SMOKE_CONTAINER" >/dev/null 2>&1 || true
  $CONTAINER_CMD run -d --name "$SMOKE_CONTAINER" --network jarvis_default \
    -p "${SMOKE_PORT}:8080" --tmpfs /data \
    -e JARVIS_DB_DSN=/data/jarvis.db \
    -e JARVIS_CLUSTER_1_NAME=verify \
    -e JARVIS_CLUSTER_1_ALERTMANAGER_URL=http://jarvis_test_alertmanager:9093 \
    -e JARVIS_AUTH_MODE=none \
    "$SMOKE_IMAGE" >/dev/null || return 1

  local ready=0
  for _ in $(seq 1 60); do
    curl -sf "http://localhost:${SMOKE_PORT}/health" >/dev/null 2>&1 && { ready=1; break; }
    sleep 1
  done
  [ "$ready" = "1" ] || { echo "container never answered on /health"; $CONTAINER_CMD logs "$SMOKE_CONTAINER" 2>&1 | tail -20; return 1; }

  curl -sf "http://localhost:${SMOKE_PORT}/health" | grep -q '"status":"ok"' \
    || { echo "/health did not report ok"; return 1; }
  # The embedded frontend (//go:build prod + embed.FS) must be served, not a 404.
  curl -sf "http://localhost:${SMOKE_PORT}/" | grep -q 'id="root"' \
    || { echo "embedded frontend not served on /"; return 1; }
  curl -sf "http://localhost:${SMOKE_PORT}/api/v1/alerts" | head -c 1 | grep -q '\[' \
    || { echo "/api/v1/alerts did not return a JSON array"; return 1; }
}

if [ "${FAST:-0}" = "1" ]; then
  skip "production image build and smoke test" "FAST=1"
elif ! have "$CONTAINER_CMD"; then
  skip "production image build and smoke test" "$CONTAINER_CMD not installed"
else
  step "build production image" $CONTAINER_CMD build -f Containerfile -t "$SMOKE_IMAGE" .

  if [ "${#FAILED[@]}" -gt 0 ] && printf '%s\n' "${FAILED[@]}" | grep -qx "build production image"; then
    skip "production image smoke test" "image build failed"
  else
    if ! $CONTAINER_CMD exec jarvis_test_alertmanager true >/dev/null 2>&1; then
      $CONTAINER_CMD network create jarvis_default >/dev/null 2>&1 || true
      "${COMPOSE_DEPS[@]}" up -d test-alertmanager >/dev/null 2>&1 && STARTED_AM=1
      sleep 2
    fi
    step "smoke test (boots, serves embedded UI, polls Alertmanager)" smoke_test
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
section "Summary"

printf '  %s%d passed%s' "$C_OK" "${#PASSED[@]}" "$C_OFF"
[ "${#FAILED[@]}"  -gt 0 ] && printf ', %s%d failed%s'  "$C_BAD"  "${#FAILED[@]}"  "$C_OFF"
[ "${#SKIPPED[@]}" -gt 0 ] && printf ', %s%d skipped%s' "$C_SKIP" "${#SKIPPED[@]}" "$C_OFF"
printf '\n'

if [ "${#FAILED[@]}" -gt 0 ]; then
  printf '\n  %sFailed:%s\n' "$C_BAD" "$C_OFF"
  printf '    ✖ %s\n' "${FAILED[@]}"
fi

if [ "${#SKIPPED[@]}" -gt 0 ]; then
  printf '\n  %sNot verified — these say nothing about the branch:%s\n' "$C_SKIP" "$C_OFF"
  printf '    • %s\n' "${SKIPPED[@]}"
fi

printf '\n'
if [ "${#FAILED[@]}" -gt 0 ]; then
  printf '  %sFAILED%s — the working tree is not clean.\n\n' "$C_BAD" "$C_OFF"
  exit 1
elif [ "${#SKIPPED[@]}" -gt 0 ]; then
  printf '  %sINCOMPLETE%s — everything that ran passed, but not everything ran.\n\n' "$C_SKIP" "$C_OFF"
  exit 2
else
  printf '  %sVERIFIED%s — every gate ran and passed.\n\n' "$C_OK" "$C_OFF"
  exit 0
fi
