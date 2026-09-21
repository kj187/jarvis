# Working with AI Coding Agents

Jarvis is developed with AI coding agents. All project knowledge follows open,
tool-neutral conventions, so any agent (Claude Code, Codex, GitHub Copilot) gets
the same content. Commit and PR rules in `AGENTS.md` apply to every tool alike.

## Layout

| Path | Content |
|---|---|
| [`AGENTS.md`](../AGENTS.md) | The single entry point ([agents.md](https://agents.md) convention): overview, critical invariants (short list), workflow rules, task router |
| [`.agents/`](../.agents/) | Reference files loaded on demand: indexes `architecture.md`, `testing.md`, `lessons.md` with topic files below them, `invariants.md` (full invariant text), `doc-sync.md` (which file to update after a change) |
| [`.agents/skills/<name>/SKILL.md`](../.agents/skills/) | Workflows as [Agent Skills](https://agentskills.io) |

## Which tool reads what

| Tool | Project instructions | Skills |
|---|---|---|
| Codex | `AGENTS.md` natively | `.agents/skills/` natively |
| GitHub Copilot | `AGENTS.md` natively | `.agents/skills/` natively (also scans `.claude/skills`) |
| Claude Code | adapter `CLAUDE.md` (a one-line `@AGENTS.md` import) | adapter `.claude/skills` (symlink to `../.agents/skills`) |

Codex and Copilot behavior is taken from the vendors' documentation and has not
been re-tested in this repository. There is deliberately no
`.github/copilot-instructions.md`: a symlink to `AGENTS.md` made Copilot load
the instructions twice. `.claude/settings.json` only pre-approves test and lint
commands; hard rules live in `.githooks/pre-commit`, the `Makefile` and CI.

## Why `AGENTS.md` has a byte budget

`AGENTS.md` is loaded into every session. Codex stops adding project
instructions at 32 KiB combined (`project_doc_max_bytes`, default 32 KiB,
including a user's global file; checked against the Codex documentation).
`scripts/check-agent-context.sh` therefore keeps `AGENTS.md` at or below 12,000
bytes — a cost budget well under that limit. Detail belongs in `.agents/`. The
32 KiB figure is not confirmed for Copilot or Claude Code.

## Extending

- **New workflow**: add `.agents/skills/<name>/SKILL.md` (frontmatter `name` =
  directory name, `description` says what it does and when to use it) and a
  mention in the `AGENTS.md` task router.
- **New tool** that reads neither `AGENTS.md` nor `.agents/skills/`: add a
  symlink or one-line import, never content of its own.

## Critical invariants

The list in `AGENTS.md` is a contract. A rule qualifies when breaking it
corrupts data, opens a security hole or causes a production incident, **and**
the rule is not obvious from the code next to it. Debugging insight without
such a consequence belongs in `.agents/lessons.md`, a single-file convention in
a code comment.

- **Propose** in the PR that fixes or introduces the behavior: a short entry in
  `AGENTS.md` (rule + code anchor), its full text as `### N.` in
  `.agents/invariants.md`, and a test that fails when it is broken. The
  maintainer decides at the PR gate.
- **Keep current** in the commit that changes the behavior.
- **Numbers are permanent** IDs cited from code, tests and docs: never renumber
  or reuse one. Retire an entry in place (`Retired: <reason>`). Replace working
  labels from a design phase by the final number before merge.

## Enforcement

`scripts/check-agent-context.sh` (pre-commit, CI job "Agent Context", `make
check-agent-context`) guards: the two adapters stay thin, skill frontmatter,
the `AGENTS.md` budget, that mentioned paths exist, identical resolved-filter
conformance fixtures on backend and frontend, and that every cited `Invariant
#<n>` exists. Whether a rule is still true remains a review duty.
