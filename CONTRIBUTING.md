# Contributing to Jarvis

Thank you for your interest in contributing!

## Prerequisites

- [Podman](https://podman.io/) + podman-compose (or Docker Compose)
- Git

No local Go or Node installation required — everything runs in containers.

## Development Setup

```bash
cp .env.example .env
# Edit .env — configure at least one cluster

podman compose -f compose.dev.yml up
# Frontend: http://localhost:5173 (Vite HMR)
# Backend:  http://localhost:8080 (air hot-reload)
```

## Commit Conventions

Format: [Conventional Commits](https://www.conventionalcommits.org/)

```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `security`

Scopes: `backend`, `frontend`, `db`, `api`, `ws`, `config`, `docker`, `docs`

Examples:
```
feat(backend): add claim history endpoint
fix(frontend): resolve filter state not persisting across navigation
security(backend): add gosec and govulncheck to pre-commit hooks
```

## Testing

See [docs/TESTING.md](docs/TESTING.md) for full instructions.

Pre-commit hooks run Go unit tests, gosec, govulncheck, and golangci-lint
automatically before each commit.

## Security

See [SECURITY.md](SECURITY.md) to report vulnerabilities.
