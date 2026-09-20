COMPOSE_DEV        = podman compose -f compose.dev.yml
COMPOSE_DEMO       = podman compose -p jarvis-demo -f compose.demo.yml
COMPOSE_TEST_DEPS  = podman compose -f compose.dev-dependencies.yml
COMPOSE_E2E        = podman compose -f compose.e2e.yml
GITLEAKS           = podman run --rm -v "$(CURDIR):/repo:ro,z" zricethezav/gitleaks:latest
FRONTEND_CONTAINER = jarvis_frontend_1
DEMO_AM_URL        = http://localhost:$(DEMO_AM_PORT)

.PHONY: help \
        setup \
        up up-build down logs ps \
        up-alertmanager down-alertmanager \
        up-alertmanager-ha down-alertmanager-ha \
        up-postgres down-postgres \
        demo-up demo-seed demo-resolve demo-reset demo-down \
        verify test-all test-backend test-frontend test-frontend-unit fuzz-backend \
        helm-lint helm-test \
        lint gosec govulncheck audit security-all check-agent-context \
        scan scan-history scan-staged scan-all \
        build \
        e2e-build e2e-down e2e e2e-mode e2e-screenshots e2e-screenshot release-video \
        fixtures-create fixtures-remove fixtures-refire fixtures-silence fixtures-unsilence \
        diagrams \
        website website-dev

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

up-alertmanager: ## Start test Alertmanager (port 9094) — auto-creates network if needed
	podman network create jarvis_default 2>/dev/null || true
	$(COMPOSE_TEST_DEPS) up -d test-alertmanager

down-alertmanager: ## Stop test Alertmanager
	$(COMPOSE_TEST_DEPS) stop test-alertmanager

up-alertmanager-ha: ## Start a 2-member Alertmanager HA gossip pair (ports 9094 + 9095)
	podman network create jarvis_default 2>/dev/null || true
	$(COMPOSE_TEST_DEPS) --profile ha up -d test-alertmanager test-alertmanager-2

down-alertmanager-ha: ## Stop the HA Alertmanager pair
	$(COMPOSE_TEST_DEPS) --profile ha stop test-alertmanager test-alertmanager-2

up-postgres: ## Start test PostgreSQL (port 5432, jarvis/jarvis/jarvis) — auto-creates network if needed
	podman network create jarvis_default 2>/dev/null || true
	$(COMPOSE_TEST_DEPS) up -d test-postgres

down-postgres: ## Stop test PostgreSQL
	$(COMPOSE_TEST_DEPS) stop test-postgres

# ── Demo stack (compose.demo.yml — separate from the dev stack) ─────────────────
# Published image + a throwaway Alertmanager. Own data volume, so demo-reset can
# wipe the history without touching ./data used by the dev stack. The dev stack
# also binds 8080 — run both at once with DEMO_PORT=8081 DEMO_AM_PORT=9096.

DEMO_PORT    ?= 8080
DEMO_AM_PORT ?= 9093
DEMO_ENV      = JARVIS_DEMO_PORT=$(DEMO_PORT) JARVIS_DEMO_AM_PORT=$(DEMO_AM_PORT)

demo-up: ## Start the demo stack (Jarvis on :8080, Alertmanager on :9093)
	$(DEMO_ENV) $(COMPOSE_DEMO) up -d
	@echo ""
	@echo "Jarvis:       http://localhost:$(DEMO_PORT)"
	@echo "Alertmanager: http://localhost:$(DEMO_AM_PORT)"
	@echo "Next: make demo-seed"

demo-seed: ## Fire the 18 demo alerts into the demo Alertmanager (~2 min)
	@ALERTMANAGER_URL=$(DEMO_AM_URL) bash scripts/fire-test-alerts.sh --profile demo

demo-resolve: ## Resolve the demo alerts — they move to Jarvis's Resolved view, history stays
	@ALERTMANAGER_URL=$(DEMO_AM_URL) bash scripts/resolve-test-alerts.sh --profile demo

demo-reset: ## Wipe the demo stack completely (alerts + Jarvis history) and start it fresh
	$(DEMO_ENV) $(COMPOSE_DEMO) down -v
	$(DEMO_ENV) $(COMPOSE_DEMO) up -d
	@echo "Demo reset. Next: make demo-seed"

demo-down: ## Remove the demo stack completely — containers and its data volume
	$(DEMO_ENV) $(COMPOSE_DEMO) down -v

# ── Tests ──────────────────────────────────────────────────────────────────────

verify: ## Verify the working tree end-to-end: every CI gate + PostgreSQL tests + prod image smoke test (FAST=1 skips the image)
	@FAST=$(FAST) scripts/verify.sh

test-all: test-backend test-frontend-unit test-frontend helm-lint helm-test ## Run all tests (backend + frontend + helm)

test-backend: ## Backend: go test -race ./...
	cd backend && go test -v -race ./...

FUZZTIME ?= 30s

fuzz-backend: ## Backend: run all Go native fuzz targets (FUZZTIME=30s per target)
	cd backend && go test ./internal/db -run '^$$' -fuzz '^FuzzRedactDSN$$' -fuzztime $(FUZZTIME)
	cd backend && go test ./internal/history -run '^$$' -fuzz '^FuzzParseNullableTimeString$$' -fuzztime $(FUZZTIME)
	cd backend && go test ./internal/config -run '^$$' -fuzz '^FuzzParseSecretKey$$' -fuzztime $(FUZZTIME)
	cd backend && go test ./internal/api -run '^$$' -fuzz '^FuzzValidateSilenceMatchers$$' -fuzztime $(FUZZTIME)
	cd backend && go test ./internal/api -run '^$$' -fuzz '^FuzzSanitizeAMMessage$$' -fuzztime $(FUZZTIME)

test-frontend: ## Frontend: functional E2E tests across all auth modes
	$(E2E_RUN) test none
	$(E2E_RUN) test internal
	$(E2E_RUN) test oidc

test-frontend-unit: ## Frontend: Vitest unit tests + 100% coverage gate (lib/alertUtils.ts only)
	podman exec $(FRONTEND_CONTAINER) sh -c "cd /app && pnpm test:unit:coverage"

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

check-agent-context: ## AI agent context: skills, tool adapters and AGENTS.md stay tool-agnostic
	scripts/check-agent-context.sh

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

# ── Diagrams (Mermaid sources in docs/diagrams/, rendered to docs/assets/) ─────
# --user 0: rootless podman maps container root to the host user, so the
# rendered files land with the correct ownership (the image's default node
# user cannot write into the mounted repo).
MERMAID = podman run --rm --user 0 -v "$(CURDIR):/data:z" docker.io/minlag/mermaid-cli:latest

diagrams: ## Render all Mermaid sources as light/dark SVG pairs in docs/assets/
	@for f in docs/diagrams/*.mmd; do \
		base="docs/assets/$$(basename $$f .mmd)"; \
		$(MERMAID) -i "/data/$$f" -o "/data/$${base}-light.svg" -t neutral -b transparent && \
		$(MERMAID) -i "/data/$$f" -o "/data/$${base}-dark.svg" -t dark -b transparent && \
		echo "rendered $${base}-{light,dark}.svg"; \
	done

# ── Docs website (VitePress in website/, content synced from the repo docs) ────
# git is required inside the container: the edit links and "last updated" read
# the real source files via `git log` (.agents/skills/website/SKILL.md).
# --user 0: rootless podman maps container root to the host user, so
# node_modules/ and .vitepress/dist/ land with the correct ownership.
WEBSITE_OPTS  = --rm --user 0 -v "$(CURDIR):/repo:z" -v jarvis_website_pnpmstore:/pnpm-store -w /repo/website
WEBSITE_IMAGE = node:22-alpine
WEBSITE_SETUP = apk add --no-cache git >/dev/null && git config --global --add safe.directory /repo && npm install -g pnpm --prefix /usr/local >/dev/null && pnpm config set store-dir /pnpm-store && pnpm install

website: ## Build the docs website (output: website/.vitepress/dist)
	podman run $(WEBSITE_OPTS) $(WEBSITE_IMAGE) sh -c "$(WEBSITE_SETUP) && pnpm run build"

website-dev: ## Serve the docs website with hot reload on http://localhost:5174
	podman run $(WEBSITE_OPTS) -it -p 5174:5174 $(WEBSITE_IMAGE) sh -c "$(WEBSITE_SETUP) && pnpm run dev"

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

release-video: ## Record + render a demo video: make release-video VERSION=1.13.0 [STEP=all|tts|record|render] [PROJECT=release|intro]
	@test -n "$(VERSION)" || { echo "usage: make release-video VERSION=<x.y.z|name> [STEP=all|tts|record|render] [PROJECT=release]"; exit 1; }
	VIDEO_PROJECT=$(or $(PROJECT),release) bash scripts/release-video.sh "$(VERSION)" $(or $(STEP),all)

# ── Fixtures ───────────────────────────────────────────────────────────────────

fixtures-create: ## Fire 27 Kubernetes-themed test alerts (test_suite=jarvis) to Alertmanager
	@bash scripts/fire-test-alerts.sh

fixtures-remove: ## Resolve all test alerts fired by fixtures-create
	@bash scripts/resolve-test-alerts.sh

fixtures-refire: ## Resolve, wait out the 60s grace period, re-fire — guarantees a new occurrence (~3-4 min)
	@bash scripts/refire-test-alerts.sh

fixtures-silence: ## Create an escaped regex silence in Alertmanager (recreate-bug repro)
	@bash scripts/create-test-silence.sh

fixtures-unsilence: ## Expire test silences created by fixtures-silence
	@bash scripts/resolve-test-silence.sh
