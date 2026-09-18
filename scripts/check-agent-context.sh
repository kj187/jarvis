#!/usr/bin/env bash
# Keeps the AI agent context tool-agnostic (docs/ai-agents.md).
#
# Usage:
#   scripts/check-agent-context.sh        # pre-commit, CI, make check-agent-context
#
# Project knowledge lives in open, tool-neutral conventions: AGENTS.md,
# reference files in .agents/, and workflows as Agent Skills in
# .agents/skills/. Rules:
#   1. Tool adapters are exactly what SYMLINK_ADAPTERS / FILE_ADAPTERS below
#      say — a symlink or a one-line file, never content of their own.
#   2. Every skill passes the reference validator of the Agent Skills spec
#      (skills-ref, pinned to SKILLS_REF_VERSION) and stays within the spec's
#      recommended SKILL.md size.
#   3. AGENTS.md stays below MAX_AGENTS_BYTES (the smallest project-instruction
#      limit among the supported tools is 32 KiB, including the user's global
#      file).
#   4. Every doc/script path mentioned in AGENTS.md exists.
#   5. AGENTS.md and everything under .agents/ never mention a specific tool
#      or tool-only syntax — tool details belong in docs/ai-agents.md.
#   6. Every docs/*.md file is registered in website/scripts/pages.mjs, so a
#      new doc can't go silently unpublished (.agents/skills/website/SKILL.md).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MAX_AGENTS_BYTES=30000
MAX_SKILL_LINES=500
SKILLS_REF_VERSION=0.1.1

# Adding a tool that reads neither AGENTS.md nor .agents/skills/: add its
# adapter here and a row to the adapter table in docs/ai-agents.md.
# path:expected symlink target
SYMLINK_ADAPTERS=(
  ".claude/skills:../.agents/skills"
)
# path:expected file content (whole file, trailing newline ignored)
FILE_ADAPTERS=(
  "CLAUDE.md:@AGENTS.md"
)

SKILLS_DIR=".agents/skills"
DENYLIST='claude|copilot|codex|anthropic|openai|gemini|\$ARGUMENTS|/project:|AskUserQuestion|TodoWrite'

errors=0
fail() {
  echo "  [Agent context] ✖ $*" >&2
  errors=$((errors + 1))
}

# ── 1. Tool adapters ──────────────────────────────────────────────────────────
for entry in "${SYMLINK_ADAPTERS[@]}"; do
  path="${entry%%:*}"
  target="${entry#*:}"
  if [ ! -L "$path" ]; then
    fail "$path must be a symlink to $target"
  elif [ "$(readlink "$path")" != "$target" ]; then
    fail "$path points to '$(readlink "$path")', expected '$target'"
  fi
done

for entry in "${FILE_ADAPTERS[@]}"; do
  path="${entry%%:*}"
  expected="${entry#*:}"
  if [ ! -f "$path" ] || [ -L "$path" ]; then
    fail "$path must be a regular file containing '$expected'"
  elif [ "$(cat "$path")" != "$expected" ]; then
    fail "$path must contain only '$expected' — adapters carry no content of their own"
  fi
done

# ── 2. Skills follow the Agent Skills spec ────────────────────────────────────
if command -v agentskills > /dev/null 2>&1; then
  validator=(agentskills)
elif command -v uvx > /dev/null 2>&1; then
  validator=(uvx -q --from "skills-ref==$SKILLS_REF_VERSION" agentskills)
elif command -v pipx > /dev/null 2>&1; then
  validator=(pipx run --spec "skills-ref==$SKILLS_REF_VERSION" agentskills)
else
  validator=()
  fail "skills validator not found — install uv or pipx (runs skills-ref==$SKILLS_REF_VERSION)"
fi

skills=0
for dir in "$SKILLS_DIR"/*/; do
  [ -d "$dir" ] || continue
  dir="${dir%/}"
  skills=$((skills + 1))
  if [ "${#validator[@]}" -gt 0 ] && ! output="$("${validator[@]}" validate "$dir" 2>&1)"; then
    fail "$dir is not a valid Agent Skill:"
    printf '%s\n' "$output" | sed 's/^/      /' >&2
  fi
  if [ -f "$dir/SKILL.md" ] && [ "$(wc -l < "$dir/SKILL.md")" -gt "$MAX_SKILL_LINES" ]; then
    fail "$dir/SKILL.md exceeds $MAX_SKILL_LINES lines — move detail into $dir/references/"
  fi
done
[ "$skills" -gt 0 ] || fail "no skills found under $SKILLS_DIR"

# ── 3. AGENTS.md size ─────────────────────────────────────────────────────────
agents_bytes="$(wc -c < AGENTS.md | tr -d ' ')"
if [ "$agents_bytes" -gt "$MAX_AGENTS_BYTES" ]; then
  fail "AGENTS.md is $agents_bytes bytes (max $MAX_AGENTS_BYTES) — move task-specific detail into .agents/"
fi

# ── 4. Paths mentioned in AGENTS.md exist ─────────────────────────────────────
# Backticked tokens that look like repository paths to docs or scripts (globs
# and placeholders like <name> are skipped).
while IFS= read -r path; do
  [ -n "$path" ] || continue
  case "$path" in *'*'* | *'<'* | *'>'*) continue ;; esac
  [ -e "$path" ] || fail "AGENTS.md mentions '$path', which does not exist"
done <<< "$(grep -o '`[A-Za-z0-9_./<>*-]*\.\(md\|sh\|mmd\|json\)`' AGENTS.md | tr -d '`' | grep '/' | sort -u || true)"

# ── 5. Neutral files stay tool-agnostic ───────────────────────────────────────
check_neutral() { # file, content
  local hits
  hits="$(printf '%s\n' "$2" | grep -inE "$DENYLIST" || true)"
  if [ -n "$hits" ]; then
    fail "$1 mentions a specific tool or tool-only syntax (tool details belong in docs/ai-agents.md):"
    printf '%s\n' "$hits" | sed 's/^/      /' >&2
  fi
}

while IFS= read -r file; do
  check_neutral "$file" "$(cat "$file")"
done <<< "$(printf 'AGENTS.md\n'; find .agents -name '*.md' -type f | sort)"

# ── 6. Every docs/*.md file is registered on the website ─────────────────────
while IFS= read -r doc; do
  [ -n "$doc" ] || continue
  grep -q "src: '$doc'" website/scripts/pages.mjs \
    || fail "$doc is not registered in website/scripts/pages.mjs (PAGES) — it would be silently unpublished"
done <<< "$(find docs -maxdepth 1 -name '*.md' | sort)"

# ── 7. Cross-language resolved-filter fixtures stay byte-identical ────────────
backend_filter_fixture="backend/internal/alertfilter/testdata/conformance.json"
frontend_filter_fixture="frontend/src/lib/testdata/resolved-filter-conformance.json"
if ! cmp -s "$backend_filter_fixture" "$frontend_filter_fixture"; then
  fail "$backend_filter_fixture and $frontend_filter_fixture must be byte-identical"
fi

if [ "$errors" -gt 0 ]; then
  exit 1
fi
echo "  [Agent context] OK"
