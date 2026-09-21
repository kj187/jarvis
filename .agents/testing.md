# Jarvis — Test Strategy & Execution

Entry point for tests: commands, `make verify`, pre-commit and CI. Per-package
matrices and frontend strategy are split out (see "Where the rest lives"
below) — load those only for the matching task. The E2E/screenshot container stack (fixtures, auth modes,
troubleshooting, spec inventory) is owned by `docs/testing-e2e.md` — read that
file before touching anything under `frontend/e2e/`, `compose.e2e.yml`,
`Containerfile.e2e`, or `scripts/e2e-run.sh`.

---

## Test Commands

```bash
# ── Backend ──────────────────────────────────────────────────
cd backend

go test ./...                      # All tests
go test -v -race ./...             # Verbose + race detector (CI standard)
go test -cover ./...               # Coverage overview
go test -v -race -coverprofile=coverage.out ./...  # Coverage report for CI
go tool cover -html=coverage.out   # Open coverage in browser

go test ./internal/history/...     # Single package
go test ./internal/api/...
go test -run TestGracePeriod ./internal/history/...  # Single test
go test ./internal/history/... ./internal/api/... ./internal/ws/... -run '^$' \
  -bench '^BenchmarkMemory' -benchmem -count=10  # Memory-allocation baselines

# Fuzzing (Go native — fuzz funcs live in *_fuzz_test.go; seed corpus +
# saved crash inputs under internal/<pkg>/testdata/fuzz/ run in normal go test)
make fuzz-backend                  # All fuzz targets, FUZZTIME=30s each (override: FUZZTIME=5m)
go test ./internal/db -run '^$' -fuzz '^FuzzRedactDSN$' -fuzztime 30s  # Single target

# ── Frontend ─────────────────────────────────────────────────
cd frontend

pnpm test                          # Playwright functional E2E (alias for test:e2e)
pnpm test:e2e                      # Playwright functional E2E (browser must be installed)
pnpm exec playwright install       # Install Playwright browsers (once)
pnpm test:unit                     # Vitest — lib/alertUtils.ts matching/formatting logic only (see `.agents/testing/frontend.md`)
pnpm test:unit:coverage            # Same, with v8 coverage report
pnpm duplication                   # jscpd code duplication check
pnpm lint                          # eslint src e2e (flat config: eslint.config.js — typescript-eslint,
                                   # react-hooks, react-refresh; react-hooks/purity + set-state-in-effect
                                   # are warn-level adoption backlog, everything else errors)
pnpm build                         # tsc -b && vite build (type-check + build)

# ── Functional E2E via Makefile (isolated container stack) ───
make e2e                           # functional suite across all auth modes (none + internal + oidc)
make e2e-mode MODE=oidc            # functional suite for ONE mode; E2E_SHARD=2/4 limits it to one Playwright shard (as CI does)
make e2e-screenshots               # regenerate all docs screenshots
make e2e-screenshot NAME=card-view # regenerate ONE screenshot
make release-video VERSION=1.13.0  # release demo video (TTS → record → render), only on request; PROJECT=intro for the product video —
                                   # .agents/skills/release-video/SKILL.md; STEP=tts|record|render

# ── Helm (no cluster needed — helm-unittest plugin required) ─
helm lint charts/jarvis/           # Static chart validation
helm unittest charts/jarvis/       # Unit tests (deployment, configmap, secret, ingress, servicemonitor, rbac, pdb)

# ── Everything via Makefile ──────────────────────────────────
make verify                        # full working-tree verification — see "make verify" below
make verify FAST=1                 # same, without the production image build + smoke test
make test-all                      # backend + frontend + helm lint + helm unittest
make test-backend                  # go test -race ./...
make fuzz-backend                  # Go native fuzz targets (FUZZTIME=30s per target)
make test-frontend                 # functional E2E (none + internal + oidc)
make test-frontend-unit            # Vitest (lib/alertUtils.ts only, needs jarvis_frontend_1 running)
make helm-lint                     # helm lint only
make helm-test                     # helm unittest only

# ── Docs website (VitePress, website/) ───────────────────────
cd website && pnpm test             # Media wiring/assets, release-version consistency, every docs/*.md in PAGES (runs in docs.yml after merge to main)
make website                       # build to website/.vitepress/dist — fails on dead internal links
make website-dev                   # hot-reload preview on http://localhost:5174/jarvis/
                                   # .agents/skills/website/SKILL.md

# ── Manual test dependencies (compose.dev-dependencies.yml) ──
make up-alertmanager               # test Alertmanager on port 9094
make down-alertmanager
make up-postgres                   # test PostgreSQL on 5432 (jarvis/jarvis/jarvis) — for JARVIS_DB_DSN=postgres://…
make down-postgres

# ── Memory load harness (loopback targets only; output is gitignored) ──
node scripts/memory-load.mjs --base-url http://127.0.0.1:8080 \
  --route '/api/v1/alerts?state=resolved' --concurrency 4 \
  --duration-seconds 600 --output tmp/memory-results/legacy-30k-c4.json

# ── PostgreSQL-backed backend tests (env-gated) ──────────────
make up-postgres
JARVIS_TEST_POSTGRES_DSN='postgres://jarvis:jarvis@localhost:5432/jarvis?sslmode=disable' \
  go test ./internal/history/...   # unset → these tests t.Skip; CI always sets it (postgres:17 service container)

# ── Manual test fixtures against the dev stack ───────────────
make fixtures-create               # fire all 27 Kubernetes-themed test alerts (label test_suite=jarvis)
make fixtures-remove               # resolve those alerts
make fixtures-refire               # resolve + wait 70s (must clear the 60s grace period,
                                    # Critical Invariant #1) + re-fire — guarantees a new
                                    # occurrence. Takes ~3-4 minutes. See .agents/lessons.md
make fixtures-silence              # create escaped-regex silence (recreate-bug repro)
make fixtures-unsilence            # expire test silences

# fire-test-alerts.sh / resolve-test-alerts.sh take --profile demo|full (default: full).
# demo = alerts 1-18 (realistic incidents), full = + 19-27 (link/label/escaping edge
# cases the screenshot suite needs). The fixtures-* targets always use full.

# ── Demo stack (compose.demo.yml, project jarvis-demo) ───────
# Published image + throwaway Alertmanager, own volume — independent of the dev
# stack, which is why demo-reset may wipe it. Docs: docs/demo.md
make demo-up                       # Jarvis :8080 + Alertmanager :9093
                                   # DEMO_PORT / DEMO_AM_PORT override both (dev stack also binds 8080)
make demo-seed                     # fire the 18 demo alerts (--profile demo)
make demo-resolve                  # resolve them — they move to the Resolved view, history stays
make demo-reset                    # down -v + up: empty Jarvis, repeatable demo
make demo-down                     # down -v: containers and the volume both gone
```

## `make verify` — full working-tree verification

`scripts/verify.sh` is the single answer to "is this branch clean and does
Jarvis still work?". It runs every gate CI runs, plus the two a local
`make test-all` does **not** cover:

- **PostgreSQL-backed tests.** `go test` skips the leader-election, WS-fanout
  and PostgreSQL history tests silently when `JARVIS_TEST_POSTGRES_DSN` is
  unset, so a green local run says nothing about the HA path (`internal/fanout`
  drops from 66% to 1.8% coverage, `internal/leader` from 67% to 25%). The
  script starts a throwaway PostgreSQL, exports the DSN, and stops it again.
- **The production image.** `//go:build prod` + `embed.FS` on distroless is
  built in CI only at release time (`release.yml`). The script builds it,
  boots it against the test Alertmanager, and asserts `/health` reports ok,
  `/` serves the embedded frontend, and `/api/v1/alerts` returns JSON.

It also checks that the local Go toolchain is at least the version `ci.yml`
pins — an older one makes `govulncheck` report standard-library CVEs the
released image never has (the Containerfile tracks `golang:1.26-alpine`).

**A step that cannot run is SKIPPED, never PASSED.** Silent skips are exactly
what makes a green run misleading, so skipped steps are listed separately and
downgrade the verdict. Exit codes: `0` VERIFIED, `1` FAILED, `2` INCOMPLETE
(everything that ran passed, but not everything ran).

The frontend steps need the dev container (`make up`); without it they are
reported as skipped rather than passing. Container engine is overridable:
`CONTAINER_CMD="docker" COMPOSE_CMD="docker compose" make verify`.

`make verify` complements the pre-commit hook and CI, it does not replace
them: it does not run the E2E suites (`make test-frontend`, ~8 min per auth
mode) or the gitleaks history scan.

## Where the rest lives

| Topic | File |
|---|---|
| Backend test matrix (per package), test utilities (in-memory SQLite, `httptest`, `echo` contexts, race detector), critical backend cases (grace period, `occurrence_count`, recorder diff), memory performance baselines | `.agents/testing/backend.md` |
| Frontend strategy: Vitest scope and 100% coverage gate, component/hook tests, Playwright specs and what they pin | `.agents/testing/frontend.md` |
| E2E container stack, fixtures, auth modes, spec inventory | `docs/testing-e2e.md` |

---

## Pre-Commit Integration

`.githooks/pre-commit` runs **conditionally based on staged paths**:

| Staged paths | Checks |
|---|---|
| `backend/**` | `go test ./... -count=1 -timeout 60s` + golangci-lint (incl. gosec and the gofmt formatter; govulncheck runs in CI only) |
| `frontend/**` | `pnpm audit --audit-level=high` + `pnpm lint` (eslint) + `pnpm test:unit:coverage` (Vitest + 100% coverage gate, `lib/alertUtils.ts`) + `pnpm duplication` (jscpd) — executed **inside the running dev container** (`jarvis_frontend_1`); hook fails if the container is not running |
| `charts/**` | `helm lint` + `helm unittest` |
| always | `scripts/check-changelogs.sh` — chart changes (outside `tests/`) must update `charts/jarvis/CHANGELOG.md`; every chart-changelog version section starts with a non-empty `### Breaking Changes`; changed `.github/release-notes/*.md` contain a Breaking Changes heading (a no-op when none of those paths are staged) |
| always | `scripts/check-agent-context.sh` (also `make check-agent-context`) — adapters stay thin, skill frontmatter (`name` = directory, `description` ≤ 1024), `AGENTS.md` ≤ 12,000 bytes, every path mentioned in `AGENTS.md` and every `.agents/…` reference exists, backend/frontend resolved-filter conformance fixtures byte-identical, every cited `Invariant #<n>` exists (`docs/ai-agents.md`) |
| always | `node scripts/check-design-drift.mjs` (also a CI step) — no raw Tailwind palette classes, colour literals or radius classes in `frontend/src` (semantic tokens only — `rounded-control`, `rounded-surface`, …; `lib/avatarUtils.ts` and `lib/heatmapUtils.ts` are allow-listed data-viz) · `node scripts/design-tokens.mjs --check` (also a CI step in the Agent Context job) — the generated colour files (`frontend/src/generated/tokens.css`, `website/.vitepress/theme/generated-tokens.css`, `frontend/e2e/video/generated-theme.ts`) must match `design/tokens.json`; `lib/themeTokens.test.ts` reads the generated CSS |
| always | **gitleaks** secret scan of the staged diff (via podman, config `.gitleaks.toml`) |

```bash
git config core.hooksPath .githooks   # enable once (or: make setup)
```

Playwright E2E runs **only in CI** (too slow for pre-commit).

---

## CI Pipeline

Split across five workflows.

### `.github/workflows/ci.yml`

```yaml
pin-check:           # ratchet: verify all GitHub Actions are SHA-pinned (globs .github/workflows/*.yml)
dco:                 # PR-only: every commit must carry a Signed-off-by trailer (git commit -s)
secrets:             # gitleaks secret scanning
agent-context:       # scripts/check-agent-context.sh (same rules as the pre-commit hook)

# Backend runs as three parallel jobs on separate runners (the PostgreSQL tests never share a
# runner with the fuzz targets — see .agents/lessons/testing-and-e2e.md). All three set up Go with
# cache-dependency-path: backend/go.sum (go.mod lives in backend/, not the repo root).
backend-test:        # "Backend Tests"
  - services.postgres: postgres:17 container, health-checked; JARVIS_TEST_POSTGRES_DSN set for the
    test step so every PostgreSQL-gated test (internal/history) runs on every PR, not just locally
  - go test -v -race -coverprofile=coverage.out ./... | go-junit-report → report.xml
  - Coverage summary → GITHUB_STEP_SUMMARY (go tool cover -func)
  - dorny/test-reporter uploads report.xml as "Backend Test Results"
  - upload-artifact: coverage.out + report.xml; coverage upload to Codecov (flag `backend`;
    backend-only by design — frontend vitest coverage measures only lib/alertUtils.ts and would
    misrepresent frontend coverage. Status checks configured in codecov.yml: project auto ±1%,
    patch 70% ±5% — thresholds absorb goroutine-timing coverage noise from -race runs)
backend-lint:        # "Backend Lint and Vulnerabilities"
  - govulncheck ./...
  - golangci-lint run   # includes gosec and the gofmt formatter (both enabled in .golangci.yml) —
                        # golangci-lint is the only Go gate here, so formatting is unchecked
                        # anywhere else; that is how struct-alignment drift once accumulated
backend-fuzz:        # "Backend Fuzz" (no PostgreSQL service)
  - fuzz targets, 20s each, `-parallel 2` (FuzzRedactDSN, FuzzParseNullableTimeString,
    FuzzParseSecretKey, FuzzValidateSilenceMatchers, FuzzSanitizeAMMessage), run one after another —
    the worker cap stops a loaded runner from failing the run with "context deadline exceeded" (not
    a finding). Never add a job that runs them in parallel with each other or with the tests.
backend:             # "Backend" — aggregator, needs the three jobs above, `if: always()`, fails on
                     # any result but success. The name is a required status check of the
                     # `protect-main` ruleset, so it must stay (as must the E2E aggregator below)

frontend:
  - pnpm audit --audit-level=high
  - pnpm lint         # eslint (flat config)
  - pnpm test:unit:coverage  # Vitest + 100% coverage gate (lib/alertUtils.ts only)
  - pnpm build
  - pnpm duplication  # jscpd code duplication check

helm:
  - scripts/check-changelogs.sh on the PR diff (PR-only; same rules as the pre-commit hook)
  - helm lint + helm unittest
```

### `.github/workflows/e2e.yml`

```yaml
e2e-shard:           # matrix, one runner and one isolated stack each (fixed host ports, so never
                     # two stacks on one runner), `make e2e-mode MODE=<mode> [E2E_SHARD=i/n]`:
                     #   none 1/4 … 4/4 (Playwright --shard), internal, oidc
e2e:                 # "Functional E2E (all auth modes)" — aggregator, needs e2e-shard, `if: always()`,
                     # fails on any result but success. Required status check name of `protect-main`
```

Renaming or splitting a job that carries a required check name (`Backend`,
`Functional E2E (all auth modes)`, …) needs an aggregator with the old name, or the
ruleset changes with it; otherwise the check stays "Expected" and blocks every merge.
Never add a workflow-level `paths` filter to `ci.yml` / `e2e.yml` for the same reason.

### `.github/workflows/codeql.yml`

CodeQL analysis for `go` and `javascript-typescript` — on push/PR to `main` and
weekly (Monday cron).

### `.github/workflows/scorecard.yml`

OpenSSF Scorecard — on push to `main` and weekly (Monday cron). Publishes
results to the OpenSSF API (README badge) and uploads SARIF to code scanning.

### `.github/workflows/chart-release.yml`

Publishes + cosign-signs the Helm chart when the `version` in `Chart.yaml` is
not yet in the registry **and** the image for its `appVersion` exists. Called
by `release.yml` (`workflow_call`, after the image build) for app releases;
also triggers on `charts/**` pushes to `main` for chart-only releases (skips
with a notice while the image is missing). Chart versioning is decoupled from
the app version — see `.agents/skills/release/SKILL.md`.

Screenshots are **not** run in CI (documentation artifact; binary PNGs would
create noisy diffs). Regenerate locally and commit the PNGs when the UI
changes.
