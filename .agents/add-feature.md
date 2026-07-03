# Jarvis — Adding a New Feature

TDD workflow + conventions checklist for new features. Base rules (TDD in the
same commit, type sync, commit format, critical invariants) live in the root
`AGENTS.md` — this file adds the step-by-step detail. For the data model, API
surface, and component tree, load `.agents/architecture.md`.

---

## Backend — New Endpoint

```
1. Add model in internal/models/models.go (Go struct + JSON tags)
2. Create *_test.go → write test → it fails (Red)
3. Implement handler in internal/api/<area>.go → test passes (Green)
4. Register route in internal/api/router.go — static segments before wildcard
   parameters (Critical Invariant #5 in AGENTS.md)
5. Pre-commit hook runs automatically: tests + golangci-lint (incl. gosec)
```

### Input Validation (REQUIRED)

- Fingerprint parameter: validate format (`[a-f0-9]{16}`)
- Pagination: cap `limit` at 100, `offset` ≥ 0
- String fields: set length limits
- HTTP client calls: always use `context.WithTimeout` (default 10s)
- Error responses: never leak internal details (`c.JSON(500, "internal error")`)

### Keep TypeScript Types in Sync

After every new Go model → add the corresponding TypeScript type in
`frontend/src/types/index.ts`. Field names must match exactly (camelCase JSON
tags in Go = camelCase in TypeScript).

---

## Frontend — New Component

```
1. Add type in types/index.ts (mirrors Go model exactly)
2. API wrapper in api/client.ts (if new endpoint)
3. TanStack Query hook in hooks/useXyz.ts
4. Write component (frontend checklist in AGENTS.md → Workflow Rules #4)
5. Playwright functional E2E for the golden path (see docs/testing-e2e.md)
```

### WS Events for New Features

If a new feature needs real-time updates, add a new event handler in
`useWebSocket.ts`:

```typescript
// In handleEvent():
case 'my_new_event': {
  const payload = event.payload as MyEventPayload
  queryClient.setQueryData(['my-key', payload.id], payload.data)
  // or: queryClient.invalidateQueries(...)
  break
}
```

Also define the new `WSType` constant in `ws/hub.go` and register it in
`models/models.go`.

---

## New Silence Action

1. Backend: `POST /api/v1/silences` supports `id` (update) and `fingerprint`
   (record event) — reusable
2. Frontend: `SilenceForm.tsx` reusable for create / edit / extend / recreate
3. Silence UI states (`pending` / `suppressed` / `expiring` / `expired`) are
   documented in `.agents/architecture.md` — all handled in
   `getEffectiveAlertState`

---

## New Cluster Parameter

If an API endpoint is cluster-specific:

1. Accept `?cluster=<name>` query parameter
2. Use `registry.Get(clusterName)` for the Alertmanager client
3. Return `404 Not Found` if cluster is not found
4. In frontend hook: include cluster name in `queryKey` for cache isolation

Mind multi-cluster identity: the same fingerprint can exist in several
clusters. Per-alert data (history, stats, comments, claims) is cluster-scoped —
pass `clusterName` through hooks and WS payloads, and use the selection-key
helpers in `lib/alertSelection.ts` (`<cluster>::<fingerprint>`) instead of a
bare fingerprint when identifying an alert across UI/URL boundaries.
