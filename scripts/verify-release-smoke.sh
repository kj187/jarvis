#!/usr/bin/env bash
# Release smoke test: verifies the published signatures of a release with the
# exact identities documented in docs/verify-release.md, and proves that the
# verification rejects signatures from any other workflow or ref.
#
# Usage: scripts/verify-release-smoke.sh [vX.Y.Z]
#   Defaults to the latest stable release. Needs network access plus cosign,
#   crane and the gh CLI. Not part of `make verify`: it tests published artifacts.

set -euo pipefail

REPO="kj187/jarvis"
ISSUER="https://token.actions.githubusercontent.com"
WF="https://github.com/${REPO}/.github/workflows"

for tool in cosign crane gh; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 2; }
done

tag="${1:-$(gh release view --repo "$REPO" --json tagName -q .tagName)}"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$ ]] || { echo "invalid tag '${tag}'" >&2; exit 2; }
version="${tag#v}"

failed=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1" >&2; failed=$((failed + 1)); }

# accepts <name> <cosign args...>: verification succeeds.
accepts() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then pass "$name"; else fail "$name"; fi; }
# rejects <name> <cosign args...>: verification fails because the identity does
# not match, so a typo in a reference cannot count as a correct rejection.
rejects() {
  local name="$1" err; shift
  if err="$("$@" 2>&1 >/dev/null)"; then
    fail "$name (verification succeeded, must fail)"
  elif grep -q 'expected identities\|expected SAN\|certificate identity' <<<"$err"; then
    pass "$name"
  else
    fail "$name (failed for another reason: $(head -c 200 <<<"$err"))"
  fi
}

echo "Release ${tag}"

digest="$(crane digest "ghcr.io/${REPO}:${version}")"
image="ghcr.io/${REPO}@${digest}"
accepts "image: release.yml at ${tag}" \
  cosign verify "$image" --certificate-identity="${WF}/release.yml@refs/tags/${tag}" --certificate-oidc-issuer="$ISSUER"
rejects "image: ci.yml is rejected" \
  cosign verify "$image" --certificate-identity="${WF}/ci.yml@refs/tags/${tag}" --certificate-oidc-issuer="$ISSUER"
rejects "image: release.yml on a branch is rejected" \
  cosign verify "$image" --certificate-identity="${WF}/release.yml@refs/heads/main" --certificate-oidc-issuer="$ISSUER"

sbom_dir="$(mktemp -d)"
trap 'rm -rf "$sbom_dir"' EXIT
gh release download "$tag" --repo "$REPO" -p 'sbom.spdx.json*' -D "$sbom_dir"
accepts "SBOM: release.yml at ${tag}" \
  cosign verify-blob "$sbom_dir/sbom.spdx.json" --bundle "$sbom_dir/sbom.spdx.json.sigstore.json" \
    --certificate-identity="${WF}/release.yml@refs/tags/${tag}" --certificate-oidc-issuer="$ISSUER"
rejects "SBOM: ci.yml is rejected" \
  cosign verify-blob "$sbom_dir/sbom.spdx.json" --bundle "$sbom_dir/sbom.spdx.json.sigstore.json" \
    --certificate-identity="${WF}/ci.yml@refs/tags/${tag}" --certificate-oidc-issuer="$ISSUER"

# Release candidates do not publish a chart.
if [[ "$tag" != *-rc.* ]]; then
  chart_version="$(gh api "repos/${REPO}/contents/charts/jarvis/Chart.yaml?ref=${tag}" --jq .content | base64 -d | awk '/^version:/{print $2}')"
  chart="ghcr.io/kj187/charts/jarvis:${chart_version}"
  chart_re='^https://github\.com/kj187/jarvis/\.github/workflows/chart-release\.yml@refs/(heads/main|tags/v[0-9].*)$'
  accepts "chart ${chart_version}: chart-release.yml on main or a tag" \
    cosign verify "$chart" --certificate-identity-regexp="$chart_re" --certificate-oidc-issuer="$ISSUER"
  rejects "chart ${chart_version}: ci.yml is rejected" \
    cosign verify "$chart" --certificate-identity="${WF}/ci.yml@refs/heads/main" --certificate-oidc-issuer="$ISSUER"
fi

[ "$failed" -eq 0 ] && echo "All checks passed." || { echo "${failed} check(s) failed." >&2; exit 1; }
