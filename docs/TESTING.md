# Testing

## Backend (Go)

### Prerequisites

No local Go installation required — tests run in a container. For local development:

```bash
go version  # requires Go 1.24+
```

### Run All Tests

```bash
cd backend
go test ./...
```

### With Coverage

```bash
cd backend
go test -cover ./...
# Generate HTML report:
go test -coverprofile=coverage.out ./... && go tool cover -html=coverage.out
```

### With Race Detector

```bash
cd backend
go test -v -race ./...
```

### Specific Package

```bash
cd backend
go test ./internal/history/...
go test ./internal/api/...
```

### In Container (no local Go needed)

```bash
podman compose -f compose.dev.yml run --rm backend go test ./...
```

### Test Packages

| Package | Coverage Target |
|---|---|
| `internal/config` | Config parsing, HOST_ALIAS logic |
| `internal/db` | Migrate idempotent, PRAGMA settings |
| `internal/history` | AlertStore, HistoryStore, Recorder diff logic |
| `internal/alertmanager` | HTTP client against httptest.NewServer |
| `internal/api` | Handler tests via echo.NewContext |
| `internal/ws` | Hub broadcast, client register/unregister |

---

## Frontend (TypeScript / React)

### Prerequisites

```bash
node --version  # requires Node 22+
pnpm --version  # requires pnpm 9+
```

### Run Vitest (unit tests)

```bash
cd frontend
pnpm test
```

### With Coverage

```bash
cd frontend
pnpm test:coverage
```

### Run Playwright (E2E tests)

```bash
cd frontend
pnpm exec playwright install --with-deps
pnpm test:e2e
```

### E2E Test Scenarios

- Alert list loads and displays
- Card View ↔ List View toggle
- Label filter adds and filters alert list
- URL state serialization: filter in URL, reload keeps filter
- Detail panel opens on alert click
- Claim set and released
- Comment added and deleted
- Silence created (form)
- WebSocket reconnect indicator

---

## CI Pipeline (GitHub Actions)

See `.github/workflows/ci.yml`. Runs on every push and PR:

1. **Backend**: `go test -race`, `gosec`, `govulncheck`, `golangci-lint`
2. **Frontend**: `pnpm audit`, `pnpm test:coverage`, `pnpm build`
