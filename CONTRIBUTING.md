# Contributing to Jarvis

Thank you for your interest in contributing!

Jarvis is developed 100% with AI coding agents. All project conventions —
workflow rules, critical invariants, commit format, and the map of deeper
reference docs — live in [AGENTS.md](AGENTS.md). That file is the single
source of truth for humans and AI agents alike; please read it first.

## Prerequisites

- [Podman](https://podman.io/) + podman-compose (or Docker Compose)
- Git

No local Go or Node installation required — everything runs in containers.

## Development Setup

```bash
# 1. Activate pre-commit hooks (once after cloning)
make setup

# 2. Copy and configure environment
cp .env.example .env
# Edit .env — configure at least one cluster

# 3. Start development stack (hot-reload)
podman compose -f compose.dev.yml up
# Frontend: http://localhost:5173 (Vite HMR)
# Backend:  http://localhost:8080 (air hot-reload)
```

## Pull Request Process

1. For anything beyond a trivial fix, please **open an issue first** so we can
   discuss the approach before you invest time.
2. Fork the repository and create a branch from `main`
   (e.g. `feat/silence-templates`, `fix/ws-reconnect`).
3. Make your change — tests belong in the **same commit** as the
   implementation (see [AGENTS.md](AGENTS.md#workflow-rules--always-follow)).
4. Run the full test suite locally before opening the PR:
   ```bash
   make test-all
   ```
5. Open the PR against `main`. Use a Conventional Commit title
   (e.g. `feat(silences): add template export`) and fill in the PR template.
6. CI must be green. Keep one logical change per PR — smaller PRs get
   reviewed faster.

You will normally get a first response within a few days. This project is
maintained by a single person, so please be patient with reviews.

## Commits

Conventional Commits — format, types, and scopes are defined in
[AGENTS.md](AGENTS.md#commit-format--conventional-commits).

## Testing

See [.agents/testing.md](.agents/testing.md) for the full test strategy and
commands, and [docs/testing-e2e.md](docs/testing-e2e.md) for the E2E /
screenshot container stack.

Pre-commit hooks run Go unit tests, gosec, govulncheck, and golangci-lint
automatically before each commit.

## Security

See [SECURITY.md](SECURITY.md) to report vulnerabilities.
