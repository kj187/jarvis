COMPOSE_DEV        = podman compose -f compose.dev.yml
COMPOSE_TEST_DEPS  = podman compose -f compose.test-dependencies.yml
GITLEAKS           = podman run --rm -v "$(CURDIR):/repo:ro,z" zricethezav/gitleaks:latest
FRONTEND_CONTAINER = jarvis_frontend_1

.PHONY: help \
        setup \
        up up-build down logs ps \
        test-am-up test-am-down \
        test-pg-up test-pg-down \
        test-all test-backend test-frontend \
        helm-lint helm-test \
        lint gosec govulncheck audit security-all \
        scan scan-history scan-staged scan-all \
        build \
        alerts-fire alerts-resolve alerts-fire-test alerts-resolve-test

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

test-am-up: ## Start test Alertmanager (port 9094) — requires dev stack running
	$(COMPOSE_TEST_DEPS) up -d test-alertmanager

test-am-down: ## Stop test Alertmanager
	$(COMPOSE_TEST_DEPS) stop test-alertmanager

test-pg-up: ## Start test PostgreSQL (port 5432, jarvis/jarvis/jarvis) — requires dev stack running
	$(COMPOSE_TEST_DEPS) up -d test-postgres

test-pg-down: ## Stop test PostgreSQL
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

# ── Test alerts ────────────────────────────────────────────────────────────────

alerts-fire: ## Fire 10 Kubernetes-themed test alerts (test_suite=jarvis) to Alertmanager
	@bash scripts/fire-test-alerts.sh

alerts-resolve: ## Resolve all test alerts fired by alerts-fire
	@bash scripts/resolve-test-alerts.sh

alerts-fire-test: ## Fire test alerts to the local test Alertmanager (port 9094, requires screenshot-up)
	@ALERTMANAGER_URL=http://localhost:9094 bash scripts/fire-test-alerts.sh

alerts-resolve-test: ## Resolve test alerts on the local test Alertmanager
	@ALERTMANAGER_URL=http://localhost:9094 bash scripts/resolve-test-alerts.sh
