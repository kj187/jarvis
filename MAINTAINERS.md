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
- Cut releases (see `.agents/release.md`)

### Contributors

Anyone may contribute via pull requests (see
[CONTRIBUTING.md](CONTRIBUTING.md)). Contributors have no direct access to
sensitive resources — all changes go through pull requests with required CI
status checks; direct commits to `main` are blocked by a repository ruleset.
