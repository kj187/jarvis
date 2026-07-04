# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in Jarvis, please do **not** open a
public GitHub issue.

Instead, please report it via one of the following channels:

- **GitHub Private Vulnerability Reporting** (preferred):
  [Report a vulnerability](https://github.com/kj187/jarvis/security/advisories/new) —
  the report is tracked privately in the repository and will not be lost.
- **Email**: mail@kj187.de

Please include:

  - A description of the vulnerability
  - Steps to reproduce
  - Potential impact
  - (Optional) A suggested fix

## Coordinated Vulnerability Disclosure

- We **aim to** acknowledge your report **within 14 days**.
- We will confirm the issue, work on a fix, and keep you informed about the
  progress. Please keep the report confidential until a fixed release is
  available.
- A fix is targeted **within 90 days** of the initial report, depending on
  severity and complexity.
- Jarvis is currently maintained by a single maintainer. Response times are
  best-effort targets; reports submitted via GitHub Private Vulnerability
  Reporting are tracked persistently and will be handled as soon as possible.

## Publication of Vulnerabilities

Fixed vulnerabilities are published as
[GitHub Security Advisories](https://github.com/kj187/jarvis/security/advisories)
including affected versions, impact, and the fixed release. Reporters are
credited unless they prefer to remain anonymous.

## Security Measures

See [docs/security.md](docs/security.md) for a full description of:

- Static analysis tooling (gosec, govulncheck, golangci-lint)
- Container hardening (distroless, non-root, read-only FS)
- Dependency update process
- User authentication options (`none`, `internal`, `oidc`) and the assumed
  deployment model (e.g. behind a trusted reverse proxy)
