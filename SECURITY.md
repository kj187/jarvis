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

You can expect an acknowledgment within **48 hours** and a resolution timeline
within **7 days** for critical issues.

## Security Measures

See [docs/SECURITY.md](docs/SECURITY.md) for a full description of:

- Static analysis tooling (gosec, govulncheck, golangci-lint)
- Container hardening (distroless, non-root, read-only FS)
- Dependency update process
- What is intentionally NOT implemented (e.g. authentication — deployment
  behind a trusted reverse proxy is assumed)
