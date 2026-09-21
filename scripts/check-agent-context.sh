#!/usr/bin/env bash
# Cheap guards for the AI agent context (docs/ai-agents.md). Runs in the
# pre-commit hook, the CI job "Agent Context" and `make check-agent-context`.
#
#   1. Tool adapters stay thin: a symlink and a one-line import.
#   2. Every skill has frontmatter with name = directory name and a description.
#   3. AGENTS.md stays below MAX_AGENTS_BYTES — it is loaded into every session
#      (a budget; the smallest tool limit is 32 KiB including a global file).
#   4. Every path mentioned in AGENTS.md exists, and so does every `.agents/...`
#      path mentioned in the AI context.
#   5. The backend and frontend resolved-filter conformance fixtures are
#      byte-identical (Critical Invariant #4).
#   6. Every cited `Invariant #<n>` is a number that AGENTS.md lists.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MAX_AGENTS_BYTES=12000

errors=0
fail() {
  echo "  [Agent context] ✖ $*" >&2
  errors=$((errors + 1))
}

# ── 1. Tool adapters ──────────────────────────────────────────────────────────
[ "$(readlink .claude/skills 2>/dev/null)" = "../.agents/skills" ] \
  || fail ".claude/skills must be a symlink to ../.agents/skills"
{ [ -f CLAUDE.md ] && [ ! -L CLAUDE.md ] && [ "$(cat CLAUDE.md)" = "@AGENTS.md" ]; } \
  || fail "CLAUDE.md must be a regular file containing only '@AGENTS.md'"

# ── 2. Skills: frontmatter name matches the directory, description present ────
skills=0
for dir in .agents/skills/*/; do
  dir="${dir%/}"
  skills=$((skills + 1))
  file="$dir/SKILL.md"
  [ -f "$file" ] || { fail "$dir has no SKILL.md"; continue; }
  [ "$(sed -n 1p "$file")" = "---" ] || fail "$file must start with '---' frontmatter"
  [ "$(sed -n 's/^name: *//p' "$file" | head -n1)" = "${dir##*/}" ] \
    || fail "$file: frontmatter 'name' must equal '${dir##*/}'"
  desc="$(sed -n 's/^description: *//p' "$file" | head -n1)"
  { [ -n "$desc" ] && [ "${#desc}" -le 1024 ]; } \
    || fail "$file: frontmatter 'description' must be present and at most 1024 characters"
done
[ "$skills" -gt 0 ] || fail "no skills found under .agents/skills"

# ── 3. AGENTS.md size ─────────────────────────────────────────────────────────
agents_bytes="$(wc -c < AGENTS.md | tr -d ' ')"
[ "$agents_bytes" -le "$MAX_AGENTS_BYTES" ] \
  || fail "AGENTS.md is $agents_bytes bytes (max $MAX_AGENTS_BYTES) — move task-specific detail into .agents/"

# ── 4. Paths mentioned in the AI context exist ────────────────────────────────
# Backticked docs/scripts paths in AGENTS.md (globs and <placeholders> skipped).
while IFS= read -r path; do
  [ -n "$path" ] || continue
  case "$path" in *'*'* | *'<'* | *'>'*) continue ;; esac
  [ -e "$path" ] || fail "AGENTS.md mentions '$path', which does not exist"
done <<< "$(grep -o '`[A-Za-z0-9_./<>*-]*\.\(md\|sh\|mmd\|json\)`' AGENTS.md | tr -d '`' | grep '/' | sort -u || true)"

# Every .agents/... reference (router, indexes, skills, doc-sync map).
while IFS= read -r path; do
  [ -n "$path" ] || continue
  [ -e "${path%/}" ] || fail "the AI context mentions '$path', which does not exist"
done <<< "$(cat AGENTS.md docs/ai-agents.md $(find .agents -name '*.md' -type f) \
  | grep -o '\.agents/[A-Za-z0-9_./-]*[A-Za-z0-9_/-]' | sed 's/[.]$//' | sort -u || true)"

# ── 5. Cross-language resolved-filter fixtures stay byte-identical ────────────
cmp -s backend/internal/alertfilter/testdata/conformance.json \
       frontend/src/lib/testdata/resolved-filter-conformance.json \
  || fail "backend/internal/alertfilter/testdata/conformance.json and frontend/src/lib/testdata/resolved-filter-conformance.json must be byte-identical"

# ── 6. Cited critical-invariant numbers exist ─────────────────────────────────
# git grep, not grep -r: skips gitignored trees (frontend/e2e/_video is GBs of
# local video output and made an earlier version of this check take ~90 s).
inv_max="$(sed -n '/^## Critical Invariants/,/^## Workflow Rules/p' AGENTS.md | grep -c '^[0-9]\+\. ' || true)"
while IFS=: read -r file line ref; do
  [ -n "$ref" ] || continue
  n="${ref##*#}"
  case "$n" in
    '' | *[!0-9]*) fail "$file:$line cites 'Invariant #$n', which is not a number" ;;
    *) { [ "$n" -ge 1 ] && [ "$n" -le "$inv_max" ]; } \
         || fail "$file:$line cites Invariant #$n, but AGENTS.md lists only $inv_max" ;;
  esac
done <<< "$(git grep --untracked -noiE 'invariant #[0-9A-Za-z]+' -- AGENTS.md CONTRIBUTING.md .agents docs backend frontend/src frontend/e2e frontend/eslint.config.js 2>/dev/null || true)"

if [ "$errors" -gt 0 ]; then
  exit 1
fi
echo "  [Agent context] OK"
