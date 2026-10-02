#!/usr/bin/env bash
# Canary for the secret scan: .gitleaks.toml must still find synthetic secrets
# (also under testdata/) and must still skip allowlisted paths. A config that
# loads no rules reports "no leaks found" for everything, so this fails then.
#
# Usage: scripts/check-gitleaks-canary.sh   (CONTAINER_CMD=docker in CI)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_CMD="${CONTAINER_CMD:-podman}"
IMAGE="$(cat "$ROOT/scripts/gitleaks-image")"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Random at runtime so no secret-shaped literal exists in this file.
rand() { local s; s="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 64)" || true; printf '%s' "${s:0:$1}"; }

for dir in src backend/internal/testdata frontend/node_modules/pkg; do
  mkdir -p "$work/$dir"
  printf 'token = %s%s\n' 'ghp_' "$(rand 36)" > "$work/$dir/canary.txt"
done
# Redefined generic-api-key rule in .gitleaks.toml must keep the default pattern.
printf 'api_key = "%s"\n' "$(rand 32 | tr 'A-Z' 'a-z')" > "$work/src/generic.txt"

set +e
report="$("$CONTAINER_CMD" run --rm \
  -v "$ROOT/.gitleaks.toml:/cfg/.gitleaks.toml:ro,z" \
  -v "$work:/scan:ro,z" \
  "$IMAGE" detect --no-git --no-banner --source=/scan -c /cfg/.gitleaks.toml \
  --report-format json --report-path - 2>/dev/null)"
status=$?
set -e

fail=0
expect_found() {
  if ! grep -q "\"File\": \"/scan/$1\"" <<<"$report"; then
    echo "FAIL: secret in $1 not detected" >&2; fail=1
  fi
}
expect_found src/canary.txt
expect_found src/generic.txt
expect_found backend/internal/testdata/canary.txt
if grep -q 'frontend/node_modules' <<<"$report"; then
  echo "FAIL: allowlisted path frontend/node_modules was scanned" >&2; fail=1
fi
if [ "$status" -eq 0 ]; then
  echo "FAIL: gitleaks exited 0 despite canary secrets" >&2; fail=1
fi

[ "$fail" -eq 0 ] && echo "gitleaks canary OK"
exit "$fail"
