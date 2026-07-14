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

# Fuzzing (Go native — fuzz funcs live in *_fuzz_test.go; seed corpus +
# saved crash inputs under internal/<pkg>/testdata/fuzz/ run in normal go test)
make fuzz-backend                  # All fuzz targets, FUZZTIME=30s each (override: FUZZTIME=5m)
go test ./internal/db -run '^$' -fuzz '^FuzzRedactDSN$' -fuzztime 30s  # Single target

# ── Frontend ─────────────────────────────────────────────────
cd frontend

pnpm test                          # Playwright functional E2E (alias for test:e2e)
pnpm test:e2e                      # Playwright functional E2E (browser must be installed)
pnpm exec playwright install       # Install Playwright browsers (once)
pnpm test:unit                     # Vitest — lib/alertUtils.ts matching/formatting logic only (see below)
pnpm test:unit:coverage            # Same, with v8 coverage report
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
make fuzz-backend                  # Go native fuzz targets (FUZZTIME=30s per target)
make test-frontend                 # functional E2E (none + internal + oidc)
make test-frontend-unit            # Vitest (lib/alertUtils.ts only, needs jarvis_frontend_1 running)
make helm-lint                     # helm lint only
make helm-test                     # helm unittest only

# ── Manual test dependencies (compose.dev-dependencies.yml) ──
make up-alertmanager               # test Alertmanager on port 9094
make down-alertmanager
make up-postgres                   # test PostgreSQL on 5432 (jarvis/jarvis/jarvis) — for JARVIS_DB_DSN=postgres://…
make down-postgres

# ── PostgreSQL-backed backend tests (env-gated) ──────────────
make up-postgres
JARVIS_TEST_POSTGRES_DSN='postgres://jarvis:jarvis@localhost:5432/jarvis?sslmode=disable' \
  go test ./internal/history/...   # unset → these tests t.Skip; CI always sets it (postgres:17 service container)

# ── Manual test fixtures against the dev stack ───────────────
make fixtures-create               # fire 23 Kubernetes-themed test alerts (label test_suite=jarvis)
make fixtures-remove               # resolve those alerts
make fixtures-refire               # resolve + wait 70s (must clear the 60s grace period,
                                    # Critical Invariant #1) + re-fire — guarantees a new
                                    # occurrence. Takes ~3-4 minutes. See .agents/lessons.md
make fixtures-silence              # create escaped-regex silence (recreate-bug repro)
make fixtures-unsilence            # expire test silences
```

---

## Backend Test Matrix

| Package | Test file | What is tested |
|---|---|---|
| `internal/config` | `config_test.go` | Config parsing, cluster-N iteration, HOST_ALIAS logic |
| `internal/config` | `config_retention_test.go` | Retention env vars: defaults (all disabled), global→domain inheritance, per-domain override even when global is 0, comments never inherit the global, sweep-interval parsing, negative/non-integer values → startup error |
| `internal/config` | `config_fuzz_test.go` | Fuzz: `parseSecretKey` never panics/errors, hex round-trip |
| `internal/db` | `db_test.go` | `Migrate` idempotent, PRAGMA settings |
| `internal/db` | `db_fuzz_test.go` | Fuzz: `RedactDSN` never panics, password never leaks |
| `internal/cluster` | `registry_test.go` | `NewRegistry`, `Get`, `All` — single/multi-cluster |
| `internal/history` | `store_test.go` | `UpsertFingerprint`, `GetOrCreateActiveEvent`, grace period (60s), `occurrence_count` logic |
| `internal/history` | `store_postgres_test.go` | `postgresTestDSN` (skip gate), `newTestPostgresStores(t, n)` — n independent `*sql.DB` connections against one truncated PostgreSQL test database, the multi-replica situation in miniature (reused by later multi-replica-plan slices' elector/recorder/fanout tests) |
| `internal/history` | `store_concurrency_test.go` | D5 (`AGENTS.md`-pending invariant): `RecordStatusChange` raced concurrently — one Store (SQLite) and 10 Stores on one PostgreSQL database (`JARVIS_TEST_POSTGRES_DSN`-gated) — exactly one resulting event row, no duplicate from a non-atomic idempotency-check-then-insert; 2 racing Postgres connections proved too narrow a window to reproduce the bug reliably (20/20 false-negative runs in development), hence 10 |
| `internal/history` | `store_extra_test.go` | `GetClaimHistory`, `RecordSilenceEvent`, `GetSilenceEvents`, `GetRecentResolved`, `SeedResolved`, silence templates |
| `internal/history` | `store_retention_test.go` | Retention delete/detach methods (`store_retention.go`): `sweepableEventsCondition` — open firing/suppressed episode head survives any age, a superseded or resolved/expired row past cutoff is deleted; batching (1200 rows/batch 500); context-cancel stops the loop; detach nulls `event_id` only on rows referencing a soon-to-be-deleted event; released-claim/comment/silence-event cutoffs (active claims always survive); orphan fingerprint sweep (survives with any remaining event/claim/comment, deletes only true orphans past `last_seen_at` cutoff); re-fire after a full event sweep does not inflate `occurrence_count` |
| `internal/history` | `alert_store_test.go` | `Set`/`Get`/`MarkResolved`/`RemoveByFingerprint` (thread safety via goroutines) |
| `internal/history` | `silence_store_test.go` | `SilenceStore`: Set/Get copy semantics, Upsert, MarkExpired, Reset, concurrent access |
| `internal/history` | `lifecycle_test.go` | Integration: FiringToResolved, SuppressedExpired, GracePeriod, ReoccurrenceAfterResolution, FullCycle |
| `internal/history` | `recorder_test.go` | Diff logic: firing/resolved/suppressed/expired transitions; poll fills `SilenceStore` per cluster, failed silence fetch keeps previous snapshot; `silences_update` broadcast only when the silence snapshot changed |
| `internal/history` | `claim_cluster_test.go` | Cluster-scoped claim isolation (same fingerprint in multiple clusters) |
| `internal/history` | `enrich_test.go` | Alert enrichment (active claim attachment) |
| `internal/history` | `optimization_test.go` | Query/indexing optimizations |
| `internal/history` | `time_fuzz_test.go` | Fuzz: `parseNullableTimeString` never panics, err/Valid contract |
| `internal/retention` | `sweeper_test.go` | `Sweeper`: disabled config → `Start` never calls the store; context cancelled before the first sweep stops cleanly; full sweep order + per-domain cutoffs against a `fakeStore` (comments → claims → silence events → detach → events → orphan, orphan cutoff = widest of the four); domains with no effective retention are skipped; one domain's error doesn't abort the rest; `jarvis_retention_*` metrics counted; nil `*metrics.Metrics` doesn't panic; `shouldSweep()` gated by a `fakeLeaderChecker` (nil elector always sweeps, follower never sweeps, leader sweeps) |
| `internal/leader` | `static_test.go` | `StaticElector`: always leader, `Subscribe` fires `fn(true)` synchronously |
| `internal/leader` | `postgres_test.go` | `PGElector` (`JARVIS_TEST_POSTGRES_DSN`-gated): exactly one of two electors racing the same DSN becomes leader; killing the leader's `Run` context releases the session lock and the follower is promoted within seconds; `Subscribe` fires exactly one `[true]` transition on promotion |
| `internal/history` | `recorder_leader_test.go` | D3-step-4 leader gating via a `fakeElector`: a follower skips `RecordStatusChange`/`RecordResolvedForCluster` (in-memory `AlertStore` still updates); the nil-elector default and an explicit leader=true elector both still write history; `reconcileStartupResolves` only runs once promoted (`reconciledClusters` guard); the delayed claim-release goroutine re-checks leadership at fire time and skips if demoted mid-delay |
| `internal/alertmanager` | `client_test.go` | HTTP client against `httptest.NewServer` |
| `internal/alertmanager` | `auth_test.go` `oauth2_test.go` | Per-cluster upstream auth (basic/bearer/OAuth2) |
| `internal/api` | `alerts_test.go` | Alert list/detail handler |
| `internal/api` | `claims_test.go` | Claim set/release handler |
| `internal/api` | `comments_test.go` | Comment create/delete handler (author-gated) |
| `internal/api` | `silences_test.go` | Silence list (snapshot-only, zero AM calls, `?cluster=` filter) + create/delete handler incl. `SilenceStore` write-through + poll trigger + silence templates CRUD + backend validation (empty/invalid matchers, endsAt checks) + AM 4xx passthrough |
| `internal/api` | `silence_validation_test.go` | `validateSilenceMatchers` (empty-string-match rule, RE2 compile), `sanitizeAMMessage`, `isUniqueViolation` |
| `internal/api` | `silence_validation_fuzz_test.go` | Fuzz: `validateSilenceMatchers` accept/reject is consistent with its own regex compilation; `sanitizeAMMessage` never panics, always bounded and newline-free |
| `internal/api` | `auth_handler_test.go` | login/logout/me/info, OIDC handlers |
| `internal/api` | `setup_test.go` | first-run `/setup` handler (internal mode, 403 when users exist) |
| `internal/api` | `admin_handler_test.go` | admin user CRUD + role/self guards |
| `internal/api` | `clusters_test.go` | Cluster health from cached poll up-state (up/degraded/all-down/no-poll-yet), zero live `/api/v2/status` calls, single-member `members` omission |
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

Frontend behaviour is verified through Playwright functional E2E against a
real running app — Zustand store actions, filter state, and every component
are covered this way, with **no general component/unit-test stack** (the
Vitest setup that covered those was removed in favor of functional E2E,
commit `test(frontend): remove unit-test stack in favor of functional e2e`).

**Narrow, deliberate exception: `src/lib/alertUtils.ts`.** This file holds
the silence-matching and effective-state logic (`matchesLabelMatchers`,
`silenceMatchesAlert`, `getEffectiveAlertState`, `getSilenceState`,
`getExpiredSilence`, `computeGroupLabelValues`, plus formatting/escaping
helpers) — pure functions where a wrong Alertmanager-matching semantic can
silence (or fail to silence) the wrong alerts. Playwright can assert what the
*UI* shows, but property-based/fuzz testing across thousands of generated
label/matcher combinations against a *reference implementation* of
Alertmanager's matching semantics isn't practical to express as browser
flows. This file therefore gets a minimal Vitest + fast-check setup, scoped
to `src/lib/**` only:

- `frontend/vitest.config.ts` — `include: ['src/lib/**/*.test.ts']`, coverage
  restricted to `src/lib/alertUtils.ts`. No jsdom/component-testing
  dependencies, no other directory is in scope.
- `frontend/src/lib/alertUtils.test.ts` — example-based tests for every
  exported function (formatting/escaping helpers, matching/state functions),
  plus `fast-check` property tests (e.g. "regex built from
  `escapeRegexValue` matches only the original literal"; "every label
  `computeGroupLabelValues` returns is present on every input alert").
- **100% coverage gate on `alertUtils.ts`** (statements/lines/functions;
  branches at 99% — the one excluded branch is `tzAbbr`'s `Intl`-dependent
  fallback, not practically testable without mocking `Date`/`Intl` for a
  cosmetic display value). Enforced by `pnpm test:unit:coverage` /
  `make test-frontend-unit`, in pre-commit and CI — a new function or branch
  added to this file needs a test in the same commit or the build fails.

This does **not** reopen the door to a general component-test stack —
anything outside `src/lib/` stays E2E-only.

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
| `frontend/**` | `pnpm audit --audit-level=high` + `pnpm lint` (eslint) + `pnpm test:unit:coverage` (Vitest + 100% coverage gate, `lib/alertUtils.ts`) + `pnpm duplication` (jscpd) — executed **inside the running dev container** (`jarvis_frontend_1`); hook fails if the container is not running |
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
  - services.postgres: postgres:17 container, health-checked; JARVIS_TEST_POSTGRES_DSN set for the
    test step so every PostgreSQL-gated test (internal/history) runs on every PR, not just locally
  - go test -v -race -coverprofile=coverage.out ./... | go-junit-report → report.xml
  - Coverage summary → GITHUB_STEP_SUMMARY (go tool cover -func)
  - dorny/test-reporter uploads report.xml as "Backend Test Results"
  - upload-artifact: coverage.out + report.xml; coverage upload to Codecov
  - govulncheck ./...
  - golangci-lint run   # includes gosec (enabled in .golangci.yml)
  - fuzz targets, 20s each (FuzzRedactDSN, FuzzParseNullableTimeString, FuzzParseSecretKey,
    FuzzValidateSilenceMatchers, FuzzSanitizeAMMessage)

frontend:
  - pnpm audit --audit-level=high
  - pnpm lint         # eslint (flat config)
  - pnpm test:unit:coverage  # Vitest + 100% coverage gate (lib/alertUtils.ts only)
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
