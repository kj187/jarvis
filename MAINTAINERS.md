# Maintainers

## Current Maintainers

| Name | GitHub | Role |
|---|---|---|
| Julian Kleinhans | [@kj187](https://github.com/kj187) | Lead Maintainer |

## Roles and Responsibilities

### Lead Maintainer

Has access to the project's sensitive resources:

- Repository administration (settings, rulesets, collaborators)
- GitHub Actions secrets and CI/CD configuration
- Container registry (GHCR) publishing and release signing
- Security reports (see [SECURITY.md](SECURITY.md))

Responsibilities:

- Review and merge pull requests
- Triage issues and coordinate vulnerability disclosure
- Cut releases (see `.agents/skills/release/SKILL.md`)

### Contributors

Anyone may contribute via pull requests (see
[CONTRIBUTING.md](CONTRIBUTING.md)). Contributors have no direct access to
sensitive resources — all changes go through pull requests with required CI
status checks; direct commits to `main` are blocked by a repository ruleset.

## Support Expectations

Jarvis is maintained by a single person, in whatever time is available
outside a day job. There is no SLA.

- **Pull requests**: normally a first response within a few days (see
  [Contributing](CONTRIBUTING.md)).
- **Security reports**: acknowledged within 14 days, a fix targeted within 90
  days depending on severity (see [Security Policy](SECURITY.md)).
- **Issues** without a pull request attached get triaged as time allows —
  there is no guaranteed turnaround.

If a response is time-critical, GitHub Private Vulnerability Reporting
(linked from [Security Policy](SECURITY.md)) is tracked more reliably than a
public issue or a plain email.

