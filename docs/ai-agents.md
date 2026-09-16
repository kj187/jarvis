# Working with AI Coding Agents

Jarvis is developed with AI coding agents and works the same with **Claude
Code, Codex and GitHub Copilot**, alone or mixed. All project knowledge
follows open, tool-neutral conventions, so no tool gets content the others
can't see.

## Layout

| Path | Convention | Content |
|---|---|---|
| [`AGENTS.md`](../AGENTS.md) | [AGENTS.md](https://agents.md) | Entry point: project overview, critical invariants, workflow rules, task router |
| [`.agents/*.md`](../.agents/) | plain Markdown | Reference knowledge: `architecture.md`, `testing.md`, `lessons.md` |
| [`.agents/skills/<name>/SKILL.md`](../.agents/skills/) | [Agent Skills](https://agentskills.io) | Step-by-step workflows: `add-feature`, `pr-workflow`, `release`, `release-video`, `scope-triage`, `security-check`, `website` |

## Tool adapters

A tool that reads neither `AGENTS.md` nor `.agents/skills/` gets the thinnest
possible adapter — a symlink or a one-line import, never content of its own.

| Tool | Project instructions | Skills |
|---|---|---|
| Codex | reads `AGENTS.md` natively | reads `.agents/skills/` natively (`$release`, `/skills`) |
| GitHub Copilot (cloud agent, CLI, VS Code agent mode, code review) | reads `AGENTS.md` natively | reads `.agents/skills/` natively (VS Code: `/release`; elsewhere picked by description) |
| Claude Code | adapter `CLAUDE.md` = `@AGENTS.md` (does not read `AGENTS.md` itself) | adapter `.claude/skills` → symlink to `../.agents/skills` (`/release 1.6.0`) |

Notes from verifying the setup:

- There is deliberately no `.github/copilot-instructions.md`: every Copilot
  agent surface reads `AGENTS.md`, and a symlink to it made Copilot load the
  instructions twice.
- Copilot also scans `.claude/skills`; the Copilot CLI was verified to list
  each skill once despite the symlink.
- `.claude/settings.json` only pre-approves test and lint commands for
  convenience. Hard rules are enforced by `.githooks/pre-commit`, the
  `Makefile` and CI — never by a tool's own configuration.
- Codex stops reading project instructions at 32 KiB combined (including a
  user's global file), so `AGENTS.md` is capped at 30,000 bytes.

## Extending

- **New workflow**: add `.agents/skills/<name>/SKILL.md` (frontmatter `name`
  equals the directory, `description` says what it does and when to use it)
  and a row in the `AGENTS.md` task router. All tools pick it up; no adapter
  needed.
- **New tool**: if it reads neither `AGENTS.md` nor `.agents/skills/`, add a
  symlink or one-line import, a row in the table above, and its entry in
  `SYMLINK_ADAPTERS`/`FILE_ADAPTERS` in `scripts/check-agent-context.sh`.

## Enforcement

`scripts/check-agent-context.sh` runs in the pre-commit hook, in the CI job
"Agent Context", and via `make check-agent-context`. It validates every skill
with the Agent Skills reference validator, checks the adapters, keeps
`AGENTS.md` within its size limit with all mentioned paths existing, and
rejects tool names or tool-only syntax in `AGENTS.md` and `.agents/`.
