# Contributing to Jarvis

Thank you for your interest in contributing!

Human and AI-agent contributions alike follow one shared rulebook: workflow
rules, critical invariants, commit format, and the map of deeper reference
docs live in [AGENTS.md](AGENTS.md). That file is the single source of truth;
please read it first.

## Working with AI agents

Jarvis works with Claude Code, Codex and GitHub Copilot, alone or mixed. All
project knowledge follows open, tool-neutral conventions:
[AGENTS.md](AGENTS.md) (project rules and invariants), reference docs in
[.agents/](.agents/) (architecture, testing, lessons learned), and step-by-step
workflows as [Agent Skills](https://agentskills.io) in
[.agents/skills/](.agents/skills/) (`add-feature`, `pr-workflow`,
`scope-triage`, `security-check`, `release`). A tool that doesn't read those
paths gets only a symlink or one-line import —
[docs/ai-agents.md](docs/ai-agents.md) lists the adapters and explains how to
add a workflow or another tool. `make check-agent-context` (also run by
the pre-commit hook and CI) keeps it that way.

## Prerequisites

- [Podman](https://podman.io/) + podman-compose (or Docker Compose)
- Git

No local Go or Node installation required — everything runs in containers.
Every command below works with Docker too; replace `podman` with `docker`.

## Tech Stack

- **Backend**: Go 1.26 · Echo v4 · SQLite / PostgreSQL (`pgx/v5`, CGO-free) · gorilla/websocket
- **Frontend**: React 19 · TypeScript 6 · Vite 8 · Tailwind CSS v4 · Zustand v5 · TanStack Query v5
- **Infrastructure**: Podman multi-stage build · distroless/static-debian12

## Development Setup

```bash
git clone https://github.com/kj187/jarvis.git
cd jarvis

# 1. Activate pre-commit hooks (once after cloning)
make setup

# 2. Copy and configure environment
cp .env.example .env
# Edit .env — set at minimum JARVIS_CLUSTER_1_NAME and JARVIS_CLUSTER_1_ALERTMANAGER_URL

# 3. Start development stack (hot-reload)
make up
# Frontend: http://localhost:5173 (Vite HMR)
# Backend:  http://localhost:8080 (air hot-reload)
```

To build and run the production image locally instead:

```bash
podman compose up --build -d   # http://localhost:8080
```

`make help` lists every target — dev stack, tests, security scans, fixtures,
the documentation website.

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

### Developer Certificate of Origin (DCO)

Every commit must be signed off to certify the
[Developer Certificate of Origin](https://developercertificate.org/) — i.e.
that you are legally authorized to contribute the change:

```bash
git commit -s
```

This adds a `Signed-off-by: Your Name <your@email>` trailer to the commit
message. The `DCO` check in CI fails any pull request containing commits
without a sign-off.

## Testing

```bash
make test-all        # backend (go test -race) + frontend E2E + helm lint + helm unittest
make test-backend    # go test -race ./...
make test-frontend   # functional E2E across all auth modes (none + internal + oidc)
make helm-lint       # helm lint charts/jarvis/
make helm-test       # helm unittest charts/jarvis/
```

Helm unit tests need no Kubernetes cluster, but the plugin has to be installed
once:

```bash
helm plugin install https://github.com/helm-unittest/helm-unittest --version v0.8.2
```

See [.agents/testing.md](.agents/testing.md) for the full test strategy and
commands, and [docs/testing-e2e.md](docs/testing-e2e.md) for the E2E /
screenshot container stack.

Pre-commit hooks run Go unit tests, gosec, govulncheck, and golangci-lint
automatically before each commit.

## Security

See [SECURITY.md](SECURITY.md) to report vulnerabilities.
