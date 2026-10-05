#!/usr/bin/env bash
# Tests for scripts/sbom.sh (merge + check). Uses small SPDX fixtures built with
# jq; needs no network, syft or container. Usage: scripts/test-sbom.sh

set -uo pipefail
unset $(git rev-parse --local-env-vars 2>/dev/null)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/sbom.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

passed=0
failed=0
pass() { passed=$((passed + 1)); echo "  ok   $1"; }
fail() { failed=$((failed + 1)); echo "  FAIL $1" >&2; [ -z "${2:-}" ] || echo "       $2" >&2; }

# run <args...>: stdout in $OUT, stderr in $ERR, exit code in $RC.
OUT="$TMP/out"
ERR="$TMP/err"
run() { "$SCRIPT" "$@" >"$OUT" 2>"$ERR"; RC=$?; }

ok() { [ "$RC" -eq 0 ] && pass "$1" || fail "$1" "rc=$RC stderr: $(head -c 300 "$ERR")"; }
# rejects <name> <stderr regex>: non-zero exit and the message names the problem.
rejects() {
  if [ "$RC" -ne 0 ] && grep -qiE -- "$2" "$ERR"; then pass "$1"; else fail "$1" "rc=$RC stderr: $(head -c 300 "$ERR")"; fi
}
q() { jq -e "$1" "$OUT" >/dev/null 2>&1; }

# Image document: root, a Go module, a Debian package, one package without a license.
IMAGE="$TMP/image.json"
jq -n '{
  spdxVersion: "SPDX-2.3", SPDXID: "SPDXRef-DOCUMENT", name: "ghcr.io/x/jarvis",
  documentNamespace: "https://example.invalid/image",
  packages: [
    {SPDXID: "SPDXRef-DocumentRoot-Image-jarvis", name: "ghcr.io/x/jarvis", licenseDeclared: "NOASSERTION", licenseConcluded: "NOASSERTION"},
    {SPDXID: "SPDXRef-Package-go-echo", name: "github.com/labstack/echo/v4", versionInfo: "v4.13.0", licenseDeclared: "NOASSERTION", licenseConcluded: "MIT"},
    {SPDXID: "SPDXRef-Package-deb-base-files", name: "base-files", versionInfo: "12", licenseDeclared: "GPL-2.0-only", licenseConcluded: "NOASSERTION"}
  ],
  relationships: [{spdxElementId: "SPDXRef-DOCUMENT", relatedSpdxElement: "SPDXRef-DocumentRoot-Image-jarvis", relationshipType: "DESCRIBES"}],
  files: [], hasExtractedLicensingInfos: []
}' >"$IMAGE"

# Frontend document: root, react, a package that also exists in the image.
FRONT="$TMP/front.json"
jq -n '{
  spdxVersion: "SPDX-2.3", SPDXID: "SPDXRef-DOCUMENT", name: "jarvis-frontend",
  documentNamespace: "https://example.invalid/front",
  packages: [
    {SPDXID: "SPDXRef-DocumentRoot-Directory-jarvis-frontend", name: "jarvis-frontend", licenseDeclared: "NOASSERTION", licenseConcluded: "NOASSERTION"},
    {SPDXID: "SPDXRef-Package-npm-jarvis-frontend", name: "jarvis-frontend", licenseDeclared: "NOASSERTION", licenseConcluded: "NOASSERTION"},
    {SPDXID: "SPDXRef-Package-npm-react", name: "react", versionInfo: "19.3.0", licenseDeclared: "MIT", licenseConcluded: "NOASSERTION"},
    {SPDXID: "SPDXRef-Package-go-echo", name: "github.com/labstack/echo/v4", versionInfo: "v4.13.0", licenseDeclared: "NOASSERTION", licenseConcluded: "MIT"}
  ],
  relationships: [], files: []
}' >"$FRONT"

MERGED="$TMP/merged.json"

# ── merge ───────────────────────────────────────────────────────────────────
run merge "$IMAGE" "$FRONT"
ok "merge: exits 0"
cp "$OUT" "$MERGED"
q '[.packages[].name] | index("react") != null' && pass "merge: frontend package added" || fail "merge: frontend package added"
q '[.packages[] | select(.name == "jarvis-frontend")] | length == 0' && pass "merge: frontend root pseudo-packages dropped" || fail "merge: frontend root pseudo-packages dropped"
q '[.packages[].SPDXID] | (length == (unique | length)) and length == 4' && pass "merge: duplicate SPDXID not added twice" || fail "merge: duplicate SPDXID not added twice"
q 'any(.relationships[]; .spdxElementId == "SPDXRef-DocumentRoot-Image-jarvis" and .relationshipType == "CONTAINS" and .relatedSpdxElement == "SPDXRef-Package-npm-react")' && pass "merge: image root contains the frontend package" || fail "merge: image root contains the frontend package"
q 'any(.relationships[]; .relationshipType == "DESCRIBES" and .relatedSpdxElement == "SPDXRef-DocumentRoot-Image-jarvis")' && pass "merge: image DESCRIBES kept" || fail "merge: image DESCRIBES kept"
q '.documentNamespace == "https://example.invalid/image"' && pass "merge: image document identity kept" || fail "merge: image document identity kept"

jq 'del(.relationships)' "$IMAGE" >"$TMP/image-no-root.json"
run merge "$TMP/image-no-root.json" "$FRONT"
rejects "merge: image without DESCRIBES root is rejected" 'root'

run merge "$TMP/missing.json" "$FRONT"
rejects "merge: missing input is rejected" 'missing|no such|cannot|not found'

# ── check ───────────────────────────────────────────────────────────────────
run check "$MERGED"
ok "check: complete SBOM passes"

jq '.packages |= map(select(.name != "react"))' "$MERGED" >"$TMP/no-react.json"
run check "$TMP/no-react.json"
rejects "check: missing npm package (react) fails" 'react'

jq '.packages |= map(select(.name != "github.com/labstack/echo/v4"))' "$MERGED" >"$TMP/no-go.json"
run check "$TMP/no-go.json"
rejects "check: missing Go module fails" 'echo'

jq '.packages |= map(select(.name != "base-files"))' "$MERGED" >"$TMP/no-os.json"
run check "$TMP/no-os.json"
rejects "check: missing image package fails" 'base-files'

# 4 packages (root, echo, base-files, react) + 6 unlicensed = 10 packages, 7 without a license.
jq '.packages += [range(0; 6) | {SPDXID: "SPDXRef-Package-x\(.)", name: "x\(.)", licenseDeclared: "NOASSERTION", licenseConcluded: "NOASSERTION"}]' "$MERGED" >"$TMP/unlicensed.json"
run check "$TMP/unlicensed.json"
rejects "check: 10% or more without license fails" 'NOASSERTION|license'

# One unlicensed package among many stays under the threshold.
jq '.packages += [range(0; 40) | {SPDXID: "SPDXRef-Package-y\(.)", name: "y\(.)", licenseDeclared: "MIT", licenseConcluded: "NOASSERTION"}]' "$MERGED" >"$TMP/licensed.json"
run check "$TMP/licensed.json"
ok "check: licenses from either field count"

echo '{ not json' >"$TMP/bad.json"
run check "$TMP/bad.json"
rejects "check: invalid JSON fails" 'json|parse'

echo '{"spdxVersion":"SPDX-2.3","packages":[]}' >"$TMP/empty.json"
run check "$TMP/empty.json"
rejects "check: empty package list fails" 'empty|no packages|react'

run check "$TMP/missing.json"
rejects "check: missing file fails" 'missing|no such|cannot|not found'

run bogus
rejects "unknown command fails" 'usage'

echo
echo "${passed} passed, ${failed} failed"
[ "$failed" -eq 0 ]
