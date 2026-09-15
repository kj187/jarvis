#!/usr/bin/env bash
# Enforces the changelog rules from .agents/release.md for a set of changed files.
#
# Usage:
#   git diff --cached --name-only        | scripts/check-changelogs.sh   # pre-commit
#   git diff --name-only "$BASE" "$HEAD" | scripts/check-changelogs.sh   # CI (PR)
#
# Rules (each only applies when the matching files are in the change set):
#   1. A change under charts/jarvis/ (except tests/ and the changelog itself)
#      must also change charts/jarvis/CHANGELOG.md.
#   2. Every version section in charts/jarvis/CHANGELOG.md starts with a
#      non-empty "### Breaking Changes" subsection — "No breaking changes."
#      when there are none, never omitted. [Unreleased] may be completely
#      empty (right after a release); once it has content, the same applies.
#   3. Every changed release-notes file (.github/release-notes/*.md) contains
#      a "Breaking Changes" heading.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART_CHANGELOG="charts/jarvis/CHANGELOG.md"

changed="$(cat)"
errors=0

fail() {
  echo "  [Changelog] ✖ $*" >&2
  errors=$((errors + 1))
}

# ── 1. Chart changes need a chart changelog entry ─────────────────────────────
chart_changes="$(printf '%s\n' "$changed" \
  | grep '^charts/jarvis/' \
  | grep -v '^charts/jarvis/tests/' \
  | grep -vx "$CHART_CHANGELOG" || true)"

if [ -n "$chart_changes" ] && ! printf '%s\n' "$changed" | grep -qx "$CHART_CHANGELOG"; then
  fail "chart files changed without updating $CHART_CHANGELOG:"
  printf '%s\n' "$chart_changes" | sed 's/^/      /' >&2
  echo "    Add an entry under '## [Unreleased]' (incl. '### Breaking Changes') — see .agents/release.md." >&2
fi

# ── 2. Chart changelog structure ──────────────────────────────────────────────
if printf '%s\n' "$changed" | grep -qx "$CHART_CHANGELOG" && [ -f "$ROOT/$CHART_CHANGELOG" ]; then
  structure_errors="$(awk '
    function check_section() {
      if (version == "") return
      if (version == "[Unreleased]" && !has_content) return
      if (!has_breaking) print "section " version " has no \"### Breaking Changes\" as its first subsection"
      else if (!breaking_content) print "section " version " has an empty \"### Breaking Changes\" subsection"
    }
    /^## \[/ {
      check_section()
      version = $2; has_breaking = 0; breaking_content = 0; in_breaking = 0; first_sub = 1; has_content = 0
      next
    }
    /^### / {
      has_content = 1
      if (version != "" && first_sub) has_breaking = ($0 == "### Breaking Changes")
      in_breaking = (version != "" && $0 == "### Breaking Changes")
      first_sub = 0
      next
    }
    /^\[[^]]+\]: / { next }
    NF > 0 { has_content = 1 }
    in_breaking && NF > 0 { breaking_content = 1 }
    END { check_section() }
  ' "$ROOT/$CHART_CHANGELOG")"
  if [ -n "$structure_errors" ]; then
    while IFS= read -r line; do fail "$CHART_CHANGELOG: $line"; done <<< "$structure_errors"
  fi
fi

# ── 3. Release notes always state breaking changes ────────────────────────────
while IFS= read -r notes; do
  [ -n "$notes" ] && [ -f "$ROOT/$notes" ] || continue
  if ! grep -Eq '^#{2,3} Breaking Changes$' "$ROOT/$notes"; then
    fail "$notes has no 'Breaking Changes' heading (write 'No breaking changes.' when there are none)"
  fi
done <<< "$(printf '%s\n' "$changed" | grep -E '^\.github/release-notes/.+\.md$' || true)"

if [ "$errors" -gt 0 ]; then
  exit 1
fi
echo "  [Changelog] OK"
