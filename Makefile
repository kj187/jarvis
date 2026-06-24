COMPOSE_DEV        = podman compose -f compose.dev.yml
COMPOSE_TEST_DEPS  = podman compose -f compose.test-dependencies.yml
COMPOSE_E2E        = podman compose -f compose.e2e.yml
GITLEAKS           = podman run --rm -v "$(CURDIR):/repo:ro,z" zricethezav/gitleaks:latest
FRONTEND_CONTAINER = jarvis_frontend_1

.PHONY: help \
        setup \
        up up-build down logs ps \
        up-alertmanager down-alertmanager \
        up-postgres down-postgres \
        test-all test-backend test-frontend \
        helm-lint helm-test \
        lint gosec govulncheck audit security-all \
        scan scan-history scan-staged scan-all \
        build \
        e2e-build e2e-down e2e e2e-mode e2e-screenshots e2e-screenshot \
        fixtures-create fixtures-remove

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

setup: ## One-time setup: activate pre-commit hooks
	git config core.hooksPath .githooks
	@echo "Pre-commit hooks activated."

# ── Dev environment ────────────────────────────────────────────────────────────

up: ## Start dev environment (Vite HMR + air hot-reload)
	$(COMPOSE_DEV) up

up-build: ## Start dev environment, rebuild images first
	$(COMPOSE_DEV) up --build

down: ## Stop dev environment
	$(COMPOSE_DEV) down

logs: ## Follow dev logs
	$(COMPOSE_DEV) logs -f

ps: ## Show status of all running containers (dev + test deps)
	podman compose ps

up-alertmanager: ## Start test Alertmanager (port 9094) — requires dev stack running
	$(COMPOSE_TEST_DEPS) up -d test-alertmanager

down-alertmanager: ## Stop test Alertmanager
	$(COMPOSE_TEST_DEPS) stop test-alertmanager

up-postgres: ## Start test PostgreSQL (port 5432, jarvis/jarvis/jarvis) — requires dev stack running
	$(COMPOSE_TEST_DEPS) up -d test-postgres

down-postgres: ## Stop test PostgreSQL
	$(COMPOSE_TEST_DEPS) stop test-postgres

# ── Tests ──────────────────────────────────────────────────────────────────────

test-all: test-backend test-frontend helm-lint helm-test ## Run all tests (backend + frontend + helm)

test-backend: ## Backend: go test -race ./...
	cd backend && go test -v -race ./...

test-frontend: ## Frontend: pnpm test (requires dev container running)
	podman exec -e CI=true $(FRONTEND_CONTAINER) sh -c "cd /app && pnpm test"

helm-lint: ## Helm: lint chart
	helm lint charts/jarvis/

helm-test: ## Helm: run unit tests (requires helm-unittest plugin)
	helm unittest charts/jarvis/

# ── Lint & static analysis ─────────────────────────────────────────────────────

lint: ## golangci-lint
	cd backend && golangci-lint run ./...

gosec: ## gosec — hardcoded secrets + SQL injection in Go
	cd backend && gosec ./...

govulncheck: ## govulncheck — CVEs in Go dependencies
	cd backend && govulncheck ./...

audit: ## pnpm audit — CVEs in frontend dependencies (requires dev container running)
	podman exec $(FRONTEND_CONTAINER) sh -c "cd /app && pnpm audit --audit-level=high"

security-all: gosec govulncheck audit ## Run all security tools (gosec + govulncheck + audit)

# ── Secret scanning ────────────────────────────────────────────────────────────

scan: ## gitleaks: scan all source files (respects .gitleaks.toml)
	$(GITLEAKS) detect --source=/repo --no-git --verbose

scan-history: ## gitleaks: scan full git history
	podman run --rm -v "$(CURDIR):/repo:ro,z" -w /repo zricethezav/gitleaks:latest detect --verbose

scan-staged: ## gitleaks: scan staged changes only (mirrors pre-commit behavior)
	git diff --cached | $(GITLEAKS) detect --pipe --redact

scan-all: scan scan-history scan-staged ## gitleaks: run all three scans (files + history + staged)

# ── Build ──────────────────────────────────────────────────────────────────────

build: ## Build production container image locally
	podman build -f Containerfile -t jarvis:local .

# ── E2E + Screenshots (isolated Playwright stack: compose.e2e.yml) ───────────────
# All targets bring the stack up fresh, run, then tear it down. The auth mode
# (none / internal / oidc) is handled by scripts/e2e-run.sh, which boots the
# stack once per mode. See docs/testing-e2e.md for the full guide.

E2E_RUN = bash scripts/e2e-run.sh
MODE   ?= none

e2e-build: ## Build the isolated e2e Jarvis image (prod frontend + e2e seed endpoints)
	$(COMPOSE_E2E) build e2e-jarvis

e2e-down: ## Force-stop and remove the e2e stack (ephemeral — all data lost)
	$(COMPOSE_E2E) down -v

e2e: ## Run the functional suite across ALL auth modes (none + internal + oidc)
	$(E2E_RUN) test none
	$(E2E_RUN) test internal
	$(E2E_RUN) test oidc

e2e-mode: ## Run the functional suite for ONE mode: make e2e-mode MODE=oidc
	$(E2E_RUN) test $(MODE)

e2e-screenshots: ## Regenerate ALL screenshots across all modes into docs/assets/
	$(E2E_RUN) screenshots none
	$(E2E_RUN) screenshots internal
	$(E2E_RUN) screenshots oidc
	@echo "Screenshots written to docs/assets/"

e2e-screenshot: ## Regenerate ONE screenshot: make e2e-screenshot NAME=card-view [MODE=none]
	@test -n "$(NAME)" || { echo "usage: make e2e-screenshot NAME=<test-name> [MODE=none]"; exit 1; }
	$(E2E_RUN) screenshot $(MODE) "$(NAME)"
	@echo "Screenshot '$(NAME)' written to docs/assets/"

# ── Fixtures ───────────────────────────────────────────────────────────────────

fixtures-create: ## Fire 10 Kubernetes-themed test alerts (test_suite=jarvis) to Alertmanager
	@bash scripts/fire-test-alerts.sh

fixtures-remove: ## Resolve all test alerts fired by fixtures-create
	@bash scripts/resolve-test-alerts.sh
