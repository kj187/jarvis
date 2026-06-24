---
description: Test strategy, commands, utilities, CI pipeline, and coverage targets for backend and frontend
---

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
| `internal/history` | `store_extra_test.go` | Claim history, silence events, silence templates, recent resolved, seed |
| `internal/alertmanager` | `client_test.go` | HTTP client against `httptest.NewServer` |
| `internal/alertmanager` | `auth_test.go` `oauth2_test.go` | Per-cluster upstream auth (basic/bearer/OAuth2) |
| `internal/api` | `alerts_test.go` | Alert list/detail handler |
| `internal/api` | `claims_test.go` | Claim set/release handler |
| `internal/api` | `comments_test.go` | Comment create/delete handler (author-gated) |
| `internal/api` | `silences_test.go` | Silence list/create handler + silence templates CRUD |
| `internal/api` | `auth_handler_test.go` | login/logout/me/info, setup, OIDC handlers |
| `internal/api` | `admin_handler_test.go` | admin user CRUD + role/self guards |
| `internal/api` | `router_test.go` | Route registration, `/groups` before `/:fingerprint/*`, protection modes |
| `internal/auth` | `jwt_test.go` `internal_provider_test.go` `middleware_test.go` | JWT sign/verify, RequireAuth/RequireAdmin |
| `internal/users` | `store_test.go` | User CRUD, OIDC upsert, bcrypt |
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

### Playwright E2E — Functional Golden Paths

E2E runs against an **isolated container stack** (own Alertmanager + Jarvis + mock-OIDC), with
fixtures created per test (alerts via AM API v2; silences/claims/comments/templates via Jarvis API;
history/resolved via a build-tag-gated seed endpoint). Browser clock is frozen for determinism.

**Alerts**
| Scenario | What is verified |
|---|---|
| Load alert list | Alerts visible, card view default, severity grouping |
| Card ↔ list view toggle | ViewToggle works, persisted (`jarvis-activeViewMode`) |
| Card pagination | Per-group "1–3 of N" paging within a severity section |
| Fullscreen mode | Enter/exit, ESC hint overlay |
| Add label filter (chip) | `=`/`!=`/`=~`/`!~`, list filters, regex validated |
| Locked default-filter chip | From Settings, cannot be removed in header |
| URL state | filter/search/view/alert in URL; reload restores |
| Search | filters by alertname + label values; ESC clears; not persisted |
| Open detail panel | `?alert=<fp>` in URL; labels, link buttons, runbook logic |
| Stats & timeline | first/last seen, occurrence count, merged event timeline |
| Set / release claim | claim visible + WS update; release removes it |
| Add / delete comment | comment appears; author-gated delete |
| AI-prompt section | collapsed by default, copy works, no network call |
| Resolved view | pagination + per-page size persisted |
| Empty state | large empty-state icon when no alerts |

**Silences**
| Scenario | What is verified |
|---|---|
| Silences page card/list/fullscreen | view toggle persisted (`jarvis-silencesViewMode`) |
| Grouping | identical silences collapse into one group card |
| Show/hide expired · sort (expires/created) | toggles + ordering |
| Create silence (3 steps) | matchers → preview → per-cluster results |
| Multi-cluster selector | ≥1 required; results per cluster |
| Live match count + affected list | updates as matchers change |
| Overlap warning · zero-match warning | shown for conflicting / empty matchers |
| Duration presets/spinners/calendar | Now/Reset, start↔end sync, end>start validation |
| Silence from alert | matchers pre-filled from alert labels |
| Expire / extend (single + group) | SilenceExpireModal, +1h/+4h/+1d |
| Re-create expired silence | reopens form with matchers |
| Templates | CRUD + apply-to-form |

**Settings / Theme**
| Scenario | What is verified |
|---|---|
| Time format relative/absolute | live preview + timestamps update |
| Default view / resolved page size / poll interval | applied + persisted |
| Default filters | become locked header chips |
| Theme toggle | `data-theme` switch, persisted |

**Auth**
| Scenario | What is verified |
|---|---|
| Mode none | NoAuthNotice shown + dismiss persisted |
| write_protect | reads public; write opens LoginModal; succeeds after login |
| full_protect | LoginPage gates whole app |
| Internal setup | first-run `/setup` creates admin |
| Login / logout | session cookie set/cleared; user menu |
| OIDC flow | start → callback → session; admin-claim → admin role |
| Admin user management | list, add, change role, delete (confirm); self-guards |

**WebSocket**
| Scenario | What is verified |
|---|---|
| Reconnect indicator | drop → red icon → reconnect |
| Live patches | alerts_update / claim_set / claim_released / comment_added |

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

## `docs/testing.md`

Full guide for contributors — prerequisites, setup, local execution, coverage reports.
