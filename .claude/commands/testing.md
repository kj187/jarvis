# Jarvis — Test Strategy & Execution

Slash-Command: `/project:testing`

Complete reference for tests: what is tested how, utilities, commands, CI integration.

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

pnpm test                          # Vitest unit tests (single run)
pnpm test:watch                    # Vitest watch mode
pnpm test:coverage                 # Vitest with coverage
pnpm test:ci                       # CI mode: JUnit XML + coverage (used in CI)
pnpm test:e2e                      # Playwright E2E (browser must be installed)
pnpm exec playwright install       # Install Playwright browsers (once)
pnpm duplication                   # jscpd code duplication check
```

---

## Backend Test Matrix

| Package | Test file | What is tested |
|---|---|---|
| `internal/config` | `config_test.go` | Config parsing, cluster-N iteration, HOST_ALIAS logic |
| `internal/db` | `db_test.go` | `Migrate` idempotent, PRAGMA settings |
| `internal/cluster` | `registry_test.go` | `NewRegistry`, `Get`, `All` — single/multi-cluster |
| `internal/history` | `store_test.go` | `UpsertFingerprint`, `GetOrCreateActiveEvent`, grace period (60s), `occurrence_count` logic |
| `internal/history` | `store_extra_test.go` | `GetClaimHistory`, `RecordSilenceEvent`, `GetSilenceEvents`, `GetRecentResolved`, `SeedResolved` |
| `internal/history` | `alert_store_test.go` | `Set`/`Get`/`MarkResolved`/`RemoveByFingerprint` (thread safety via goroutines) |
| `internal/history` | `lifecycle_test.go` | Integration: FiringToResolved, SuppressedExpired, GracePeriod, ReoccurrenceAfterResolution, FullCycle |
| `internal/history` | `recorder_test.go` | Diff logic: firing/resolved/suppressed/expired transitions |
| `internal/alertmanager` | `client_test.go` | HTTP client against `httptest.NewServer` |
| `internal/api` | `alerts_test.go` | Alert list/detail handler |
| `internal/api` | `claims_test.go` | Claim set/release handler |
| `internal/api` | `comments_test.go` | Comment create/delete handler |
| `internal/api` | `silences_test.go` | Silence list/create handler |
| `internal/api` | `router_test.go` | Route registration, `/groups` before `/:fingerprint/*` |
| `internal/ws` | `hub_test.go` | Broadcast, client register/unregister, slow client drop |

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

### Grace Period (60s)

```
Scenario: Alert resolved → re-fires within 60s
Expected: GetOrCreateActiveEvent returns the OLD event (reopened)
          NO new event is created
          occurrence_count is NOT incremented

Scenario: Alert resolved → re-fires after 61s
Expected: New event is created
          occurrence_count IS incremented (hadPreviousEvent = true)
```

### `occurrence_count`

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

### Vitest Unit Tests (components + utils)

- `lib/alertUtils.test.ts` — `getEffectiveAlertState`, `matchesLabelMatchers`, `safeRegex`, `getFilterableLabels`
- Especially: edge cases for regex matchers, `@cluster`/`@receiver` pseudo-labels
- Store tests: Zustand actions, filter state

### Playwright E2E Golden Paths

| Scenario | What is verified |
|---|---|
| Load alert list | Alerts visible, card view is default |
| Card ↔ list view toggle | ViewToggle works, localStorage persistent |
| Add label filter | Alert list filters correctly |
| URL state: filter in URL | After reload filters are restored |
| Open detail panel via click | Sheet opens, `?alert=<fp>` in URL |
| Set claim | Claim visible, WS update received |
| Release claim | Claim disappears |
| Add comment | Comment visible in list |
| Delete comment | Comment removed |
| Create silence (form) | Silence visible in silences page |
| WS reconnect indicator | Connection drop → icon changes |

---

## Pre-Commit Integration

Go unit tests run **mandatorily** before every commit via `.githooks/pre-commit`:

```bash
git config core.hooksPath .githooks   # enable once
```

Playwright E2E runs **only in CI** (too slow for pre-commit).

---

## CI Pipeline (`.github/workflows/ci.yml`)

```yaml
backend:
  - go test -v -race -coverprofile=coverage.out ./... | go-junit-report → report.xml
  - Coverage summary → GITHUB_STEP_SUMMARY (go tool cover -func)
  - dorny/test-reporter@v1 uploads report.xml as "Backend Tests"
  - upload-artifact: coverage.out + report.xml
  - gosec ./...
  - govulncheck ./...
  - golangci-lint run

frontend:
  - pnpm audit --audit-level=high
  - pnpm test:ci   # JUnit XML → test-results/junit.xml + lcov/json-summary coverage
  - Coverage summary → GITHUB_STEP_SUMMARY (Statements/Branches/Functions/Lines)
  - dorny/test-reporter@v1 uploads junit.xml as "Frontend Tests"
  - upload-artifact: coverage/
  - pnpm build
  - pnpm duplication  # jscpd code duplication check
```

---

## `docs/TESTING.md`

Full guide for contributors — prerequisites, setup, local execution, coverage reports.
