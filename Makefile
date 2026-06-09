COMPOSE_DEV        = podman compose -f compose.dev.yml
GITLEAKS           = podman run --rm -v "$(CURDIR):/repo:ro,z" zricethezav/gitleaks:latest
FRONTEND_CONTAINER = jarvis_frontend_1

.PHONY: help \
        up up-build down logs \
        test-all test-backend test-frontend \
        lint gosec govulncheck audit security-all \
        scan scan-history scan-staged scan-all \
        build

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── Dev environment ────────────────────────────────────────────────────────────

up: ## Start dev environment (Vite HMR + air hot-reload)
	$(COMPOSE_DEV) up

up-build: ## Start dev environment, rebuild images first
	$(COMPOSE_DEV) up --build

down: ## Stop dev environment
	$(COMPOSE_DEV) down

logs: ## Follow dev logs
	$(COMPOSE_DEV) logs -f

# ── Tests ──────────────────────────────────────────────────────────────────────

test-all: test-backend test-frontend ## Run all tests (backend + frontend)

test-backend: ## Backend: go test -race ./...
	cd backend && go test -v -race ./...

test-frontend: ## Frontend: pnpm test (requires dev container running)
	podman exec -e CI=true $(FRONTEND_CONTAINER) sh -c "cd /app && pnpm test"

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
