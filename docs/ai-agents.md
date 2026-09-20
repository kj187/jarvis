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
| [`.agents/skills/<name>/SKILL.md`](../.agents/skills/) | [Agent Skills](https://agentskills.io) | Step-by-step workflows: `add-feature`, `design-system`, `pr-workflow`, `release`, `release-video`, `scope-triage`, `security-check`, `website` |

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

## Critical invariants: ownership and lifecycle

The invariant list in `AGENTS.md` is a contract, not a wish list. Who does
what:

| Step | Who | Rule |
|---|---|---|
| Propose | Author (human or agent) | In the PR that fixes or introduces the behaviour, never as a follow-up: one entry, a code anchor (the function or file the rule lives in) and a test that fails when it is broken, all in the same commit. |
| Decide | Maintainer | At the PR gate. Without an explicit go the entry does not land. |
| Review | Reviewer | Checks a diff against the whole list, not only the invariants the author mentions. With a single maintainer this is the merge gate itself. |
| Keep current | Author of any change that touches the behaviour | Same commit: update the entry, the anchor comment and the documents named in `AGENTS.md` → Workflow Rules #6. |
| Retire | Maintainer | Never delete. Keep the number and mark the entry `Retired: <reason>`. |

What qualifies: breaking it corrupts data, opens a security hole or causes a
production incident, **and** the rule is not obvious from the code next to
it. Debugging insight without such a consequence belongs in
`.agents/lessons.md`, a single-file convention in a code comment.

Numbers are permanent identifiers. Code comments, lessons and tests cite
them (`Invariant #<n>`), so they are never renumbered or reused. Working
labels from a design or bug-hunt phase (for example "D5") must be replaced by
the final number before merge.

`scripts/check-agent-context.sh` fails when a cited invariant number does not
exist in `AGENTS.md`. It cannot tell whether the rule is still true; that
stays a review duty.

## Enforcement

`scripts/check-agent-context.sh` runs in the pre-commit hook, in the CI job
"Agent Context", and via `make check-agent-context`. It validates every skill
with the Agent Skills reference validator, checks the adapters, keeps
`AGENTS.md` within its size limit with all mentioned paths existing, and
rejects tool names or tool-only syntax in `AGENTS.md` and `.agents/`. It also
keeps the backend and frontend copies of the resolved-filter conformance
fixture byte-identical so both language implementations test the same cases,
and rejects citations of a critical invariant number that does not exist.
