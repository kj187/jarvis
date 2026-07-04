# Jarvis — Test Strategy & Execution

Complete reference for tests: what is tested how, utilities, commands, CI
integration. The E2E/screenshot container stack (fixtures, auth modes,
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

# ── Frontend ─────────────────────────────────────────────────
cd frontend

pnpm test                          # Playwright functional E2E (alias for test:e2e)
pnpm test:e2e                      # Playwright functional E2E (browser must be installed)
pnpm exec playwright install       # Install Playwright browsers (once)
pnpm duplication                   # jscpd code duplication check
pnpm lint                          # eslint src e2e (flat config: eslint.config.js — typescript-eslint,
                                   # react-hooks, react-refresh; react-hooks/purity + set-state-in-effect
                                   # are warn-level adoption backlog, everything else errors)
pnpm build                         # tsc -b && vite build (type-check + build)

# ── Functional E2E via Makefile (isolated container stack) ───
make e2e                           # functional suite across all auth modes (none + internal + oidc)
make e2e-mode MODE=oidc            # functional suite for ONE mode
make e2e-screenshots               # regenerate all docs screenshots
make e2e-screenshot NAME=card-view # regenerate ONE screenshot

# ── Helm (no cluster needed — helm-unittest plugin required) ─
helm lint charts/jarvis/           # Static chart validation
helm unittest charts/jarvis/       # Unit tests (deployment, configmap, secret, ingress)

# ── Everything via Makefile ──────────────────────────────────
make test-all                      # backend + frontend + helm lint + helm unittest
make test-backend                  # go test -race ./...
make test-frontend                 # functional E2E (none + internal + oidc)
make helm-lint                     # helm lint only
make helm-test                     # helm unittest only

# ── Manual test dependencies (compose.dev-dependencies.yml) ──
make up-alertmanager               # test Alertmanager on port 9094
make down-alertmanager
make up-postgres                   # test PostgreSQL on 5432 (jarvis/jarvis/jarvis) — for JARVIS_DB_DSN=postgres://…
make down-postgres

# ── Manual test fixtures against the dev stack ───────────────
make fixtures-create               # fire 10 Kubernetes-themed test alerts (label test_suite=jarvis)
make fixtures-remove               # resolve those alerts
make fixtures-silence              # create escaped-regex silence (recreate-bug repro)
make fixtures-unsilence            # expire test silences
```

---

## Backend Test Matrix

| Package | Test file | What is tested |
|---|---|---|
| `internal/config` | `config_test.go` | Config parsing, cluster-N iteration, HOST_ALIAS logic |
| `internal/db` | `db_test.go` | `Migrate` idempotent, PRAGMA settings |
| `internal/cluster` | `registry_test.go` | `NewRegistry`, `Get`, `All` — single/multi-cluster |
| `internal/history` | `store_test.go` | `UpsertFingerprint`, `GetOrCreateActiveEvent`, grace period (60s), `occurrence_count` logic |
| `internal/history` | `store_extra_test.go` | `GetClaimHistory`, `RecordSilenceEvent`, `GetSilenceEvents`, `GetRecentResolved`, `SeedResolved`, silence templates |
| `internal/history` | `alert_store_test.go` | `Set`/`Get`/`MarkResolved`/`RemoveByFingerprint` (thread safety via goroutines) |
| `internal/history` | `lifecycle_test.go` | Integration: FiringToResolved, SuppressedExpired, GracePeriod, ReoccurrenceAfterResolution, FullCycle |
| `internal/history` | `recorder_test.go` | Diff logic: firing/resolved/suppressed/expired transitions |
| `internal/history` | `claim_cluster_test.go` | Cluster-scoped claim isolation (same fingerprint in multiple clusters) |
| `internal/history` | `enrich_test.go` | Alert enrichment (active claim attachment) |
| `internal/history` | `optimization_test.go` | Query/indexing optimizations |
| `internal/alertmanager` | `client_test.go` | HTTP client against `httptest.NewServer` |
| `internal/alertmanager` | `auth_test.go` `oauth2_test.go` | Per-cluster upstream auth (basic/bearer/OAuth2) |
| `internal/api` | `alerts_test.go` | Alert list/detail handler |
| `internal/api` | `claims_test.go` | Claim set/release handler |
| `internal/api` | `comments_test.go` | Comment create/delete handler (author-gated) |
| `internal/api` | `silences_test.go` | Silence list/create handler + silence templates CRUD |
| `internal/api` | `auth_handler_test.go` | login/logout/me/info, OIDC handlers |
| `internal/api` | `setup_test.go` | first-run `/setup` handler (internal mode, 403 when users exist) |
| `internal/api` | `admin_handler_test.go` | admin user CRUD + role/self guards |
| `internal/api` | `router_test.go` | Route registration, `/groups` before `/:fingerprint/*`, protection modes |
| `internal/auth` | `jwt_test.go` `internal_provider_test.go` `middleware_test.go` | JWT sign/verify, RequireAuth/RequireAdmin |
| `internal/users` | `store_test.go` | User CRUD, OIDC upsert, bcrypt |
| `internal/ws` | `hub_test.go` | Broadcast, client register/unregister, slow client drop, `jarvis_ws_broadcasts_total` |
| `internal/metrics` | `collector_test.go` | `storeCollector` scrape-time output (`testutil.CollectAndCompare`), nil `clusterUp`, `jarvis_build_info`, duplicate-registration panic |
| `internal/metrics` | `echo_test.go` | HTTP middleware: route-pattern label (not raw path), 404 → `unmatched`, skip list (`/metrics`/`/health`/`/ws`) |

---

## Backend Test Utilities

### In-memory SQLite for DB tests

```go
// No filesystem needed — fast and isolated:
db, err := db.Open(":memory:")
```

### `httptest.NewServer` for AM client tests

```go
// Real HTTP server in test — no interface mocking of the HTTP stack:
ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(mockAlerts)
}))
defer ts.Close()
client := alertmanager.NewClient(ts.URL)
```

### `echo.NewContext` for handler tests

```go
e := echo.New()
req := httptest.NewRequest(http.MethodGet, "/api/v1/alerts", nil)
rec := httptest.NewRecorder()
c := e.NewContext(req, rec)
// call handler, check response
```

### Race Detector

```go
// For alert_store_test.go: call Set/Get from multiple goroutines simultaneously
go func() { store.Set(alerts) }()
go func() { _ = store.Get() }()
// Race detector finds data races if sync.RWMutex is missing or used incorrectly
```

---

## Critical Backend Test Cases

### Grace Period (60s) — Critical Invariant #1

```
Scenario: Alert resolved → re-fires within 60s
Expected: GetOrCreateActiveEvent returns the OLD event (reopened)
          NO new event is created
          occurrence_count is NOT incremented

Scenario: Alert resolved → re-fires after 61s
Expected: New event is created
          occurrence_count IS incremented (hadPreviousEvent = true)
```

### `occurrence_count` — Critical Invariant #2

```
First firing:              occurrence_count = 1  (on INSERT)
Second firing (new):       occurrence_count = 2  (GetOrCreateActiveEvent increments)
Third firing (new):        occurrence_count = 3
Grace period reopen:       occurrence_count unchanged (no new event)
```

### Recorder Diff Logic

```
firing → resolved:    call ResolveEvents + ReleaseClaimsForResolved
firing → suppressed:  GetOrCreateActiveEvent with status=suppressed
suppressed → firing:  write expired event + new firing event
suppressed → resolved: directly resolved, no expired event
```

---

## Frontend Test Strategy

There are **no frontend unit tests** (no Vitest). The unit-test stack was
removed in favor of functional E2E (commit `test(frontend): remove unit-test
stack in favor of functional e2e`). All frontend behaviour — including
`alertUtils` logic (`getEffectiveAlertState`, `matchesLabelMatchers`,
`safeRegex`, `getFilterableLabels`, regex matchers, `@cluster`/`@receiver`
pseudo-labels) and Zustand store actions/filter state — is verified through
Playwright functional E2E against a real running app.

Specs live under `frontend/e2e/`:

- `e2e/functional/<mode>/*.spec.ts` — functional golden paths per auth mode (`none`, `internal`, `oidc`)
- `e2e/screenshots/<mode>/*.screenshot.spec.ts` — screenshot generation for docs (`docs/assets/`)
- `e2e/fixtures/`, `e2e/support/` — shared fixtures and helpers

The complete spec inventory (which spec file covers which scenario), the
container stack architecture, fixture setup, auth-mode details, and
troubleshooting are documented in **`docs/testing-e2e.md`**.

---

## Pre-Commit Integration

`.githooks/pre-commit` runs **conditionally based on staged paths**:

| Staged paths | Checks |
|---|---|
| `backend/**` | `go test ./... -count=1 -timeout 60s` + golangci-lint (incl. gosec; govulncheck runs in CI only) |
| `frontend/**` | `pnpm audit --audit-level=high` + `pnpm lint` (eslint) + `pnpm duplication` (jscpd) — executed **inside the running dev container** (`jarvis_frontend_1`); hook fails if the container is not running |
| `charts/**` | `helm lint` + `helm unittest` |
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

backend:
  - go test -v -race -coverprofile=coverage.out ./... | go-junit-report → report.xml
  - Coverage summary → GITHUB_STEP_SUMMARY (go tool cover -func)
  - dorny/test-reporter uploads report.xml as "Backend Test Results"
  - upload-artifact: coverage.out + report.xml; coverage upload to Codecov
  - govulncheck ./...
  - golangci-lint run   # includes gosec (enabled in .golangci.yml)

frontend:
  - pnpm audit --audit-level=high
  - pnpm lint         # eslint (flat config)
  - pnpm build
  - pnpm duplication  # jscpd code duplication check

helm:
  - helm lint + helm unittest
```

### `.github/workflows/e2e.yml`

```yaml
e2e:
  - make e2e          # Functional suite across none + internal + oidc
```

### `.github/workflows/codeql.yml`

CodeQL analysis for `go` and `javascript-typescript` — on push/PR to `main` and
weekly (Monday cron).

### `.github/workflows/scorecard.yml`

OpenSSF Scorecard — on push to `main` and weekly (Monday cron). Publishes
results to the OpenSSF API (README badge) and uploads SARIF to code scanning.

### `.github/workflows/chart-release.yml`

Publishes + cosign-signs the Helm chart when `charts/**` changes on `main`
and the `version` in `Chart.yaml` is not yet in the registry (chart versioning
is decoupled from the app version — see `.agents/release.md`).

Screenshots are **not** run in CI (documentation artifact; binary PNGs would
create noisy diffs). Regenerate locally and commit the PNGs when the UI
changes.
