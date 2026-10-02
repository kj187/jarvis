# How Jarvis is built — AI and engineering

Jarvis is developed with heavy use of AI coding agents. This page says what
that means, what it does not mean, and how you can check the result yourself.
For the technical setup (context files, skills, tool adapters) see
[Working with AI agents](ai-agents.md).

## The short version

- **AI writes most of the code**, for speed.
- **It is not vibe-coded.** A human decides what Jarvis is and is not
  ([Scope](scope.md)), the architecture, the security model and every merge.
- **The bar is the same as for hand-written code**, enforced by machines: tests
  first, static analysis, vulnerability scans, signed releases and a protected
  `main` branch.
- **It is a private spare-time project**, with no sponsor and no employer. AI is
  how one person can keep this level of discipline across backend, frontend,
  charts, docs and tests.

## Who is behind it

Jarvis is maintained by Julian Kleinhans, who has over 20 years in IT, nine of
them in DevOps and platform engineering. That experience goes into the parts AI
is weakest at: judging which failures matter in production and which shortcut
will hurt later.

Today that is one person. The goal is a community and a small team of
co-maintainers. The project is built for it: Apache 2.0, architecture,
invariants and tests documented in the repository, a
[contributing guide](https://github.com/kj187/jarvis/blob/main/CONTRIBUTING.md),
and the same CI gates for every pull request, reproducible locally with
`make verify`. Regular contributors are welcome to grow into
[maintainers](https://github.com/kj187/jarvis/blob/main/MAINTAINERS.md).

## Who decides what

| Maintainer | AI, under the rules below |
|---|---|
| Scope, architecture, security model | Implements a feature against an agreed design |
| New dependencies, release timing | Writes the tests, then the code |
| Every merge and release | Keeps docs and changelogs in sync |
| The list of critical invariants | Reviews a diff against that list as an extra pass |

AI is never the last reviewer: a change reaches `main` only through a pull
request the maintainer has approved.

## Guardrails

Each of these is a file in the repository or a CI job you can inspect.

- **Rules for the agent.**
  [`AGENTS.md`](https://github.com/kj187/jarvis/blob/main/AGENTS.md) holds the
  workflow rules and a numbered list of critical invariants (for example: the
  database DSN is never logged raw, no CORS wildcard, a failed cluster fetch
  never resolves alerts). Tests come first, in the same commit as the code.
- **Same pipeline for everyone.** Every pull request runs backend tests with the
  race detector, fuzzing, PostgreSQL integration tests, frontend lint and
  tests, browser end-to-end tests, gosec, golangci-lint, govulncheck,
  `pnpm audit`, CodeQL and a secret scan. GitHub Actions are pinned by commit
  SHA, dependencies are updated automatically, and every commit needs a DCO
  sign-off.
- **Verifiable releases.** Images and Helm charts carry a keyless signature,
  build provenance and an SBOM: [Verify release artifacts](verify-release.md).
- **Hardened runtime.** Distroless non-root image, read-only filesystem,
  `no-new-privileges`, strict CSP and CORS. See the [Security model](security.md).

## What this does not give you

- **No independent security audit.** The controls reduce risk; they do not
  replace a penetration test.
- **A single maintainer today** is a bus-factor risk. The open license and
  documented codebase make a fork or handover possible, but that is not a
  succession plan. Response times in the
  [Security Policy](https://github.com/kj187/jarvis/blob/main/SECURITY.md) are
  best-effort, and there is no commercial support. A contributor team is the
  real remedy, which is why this page asks for help.
- **Passing tests is not proof of correctness**, for AI-written code or
  human-written code.
- **Signatures prove origin, not intent.** They show an artifact came from this
  repository's release workflow, not that the source is bug-free.

Jarvis is an **internal tool** for use behind a VPN or an authentication proxy,
not for direct internet exposure. Where an outage or compromise would be
serious, do your own review. The code is open, the checks are reproducible, and
findings are welcome through
[private vulnerability reporting](https://github.com/kj187/jarvis/security/advisories/new).
