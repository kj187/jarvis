# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in Jarvis, please do **not** open a
public GitHub issue.

Instead, please report it via one of the following channels:

- **Email**: mail@kj187.de  
  Please include:
  - A description of the vulnerability
  - Steps to reproduce
  - Potential impact
  - (Optional) A suggested fix

## Coordinated Vulnerability Disclosure

- You will receive an **initial response within 14 days** of your report.
- We will confirm the issue, work on a fix, and keep you informed about the
  progress. Please keep the report confidential until a fixed release is
  available.
- A fix is targeted **within 90 days** of the initial report, depending on
  severity and complexity.

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
- What is intentionally NOT implemented (e.g. authentication — deployment
  behind a trusted reverse proxy is assumed)
