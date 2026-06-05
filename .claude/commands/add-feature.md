# Jarvis — Adding a New Feature

Slash-Command: `/project:add-feature`

TDD workflow + conventions checklist for new features. Always commit tests in the same commit as the implementation.

---

## Backend — New Endpoint

```
1. Add model in internal/models/models.go (Go struct + JSON tags)
2. Create *_test.go → write test → it fails (Red)
3. Implement handler in internal/api/<area>.go → test passes (Green)
4. Register route in internal/api/router.go (mind the order!)
5. Pre-commit hook runs automatically: tests + gosec + govulncheck + golangci-lint
```

### Route Order (CRITICAL)

`/api/v1/alerts/groups` must be registered **before** `/api/v1/alerts/:fingerprint/*`.
General rule: static segments before wildcard parameters.

### Input Validation (REQUIRED)

- Fingerprint parameter: validate format (`[a-f0-9]{16}`)
- Pagination: cap `limit` at 100, `offset` ≥ 0
- String fields: set length limits
- HTTP client calls: always use `context.WithTimeout` (default 10s)
- Error responses: never leak internal details (`c.JSON(500, "internal error")`)

### Keep TypeScript Types in Sync

After every new Go model → add the corresponding TypeScript type in `frontend/src/types/index.ts`. Field names must match exactly (camelCase JSON tags in Go = camelCase in TypeScript).

---

## Frontend — New Component

```
1. Add type in types/index.ts (mirrors Go model exactly)
2. API wrapper in api/client.ts (if new endpoint)
3. TanStack Query hook in hooks/useXyz.ts
4. Write component (see checklist below)
5. Vitest unit test or Playwright E2E for golden path
```

### Component Checklist

- [ ] All clickable elements have `cursor: pointer` (link, button, card, row, chip, badge)
- [ ] No `console.log` in production code
- [ ] Import shared utils from `lib/alertUtils.ts` — **never** re-implement `matchesLabelMatchers`, `getFilterableLabels`, or `getEffectiveAlertState` inside a component
- [ ] No `dangerouslySetInnerHTML`
- [ ] TypeScript `strict: true` — no `any` types without justification
- [ ] Handle error states (loading state, error state)

### WS Events for New Features

If a new feature needs real-time updates, add a new event handler in `useWebSocket.ts`:

```typescript
// In handleEvent():
case 'my_new_event': {
  const payload = event.payload as MyEventPayload
  queryClient.setQueryData(['my-key', payload.id], payload.data)
  // oder: queryClient.invalidateQueries(...)
  break
}
```

Also define the new `WSType` constant in `ws/hub.go` and register it in `models/models.go`.

---

## Commit Format

```
feat(<scope>): <description>
test(<scope>): add tests for <feature>
```

Tests always in the **same commit** as the implementation. Scope examples: `alerts`, `silences`, `claims`, `comments`, `ws`, `api`.

---

## New Silence Action

1. Backend: `POST /api/v1/silences` supports `id` (update) and `fingerprint` (record event) — reusable
2. Frontend: `SilenceForm.tsx` reusable for create / edit / extend / recreate
3. Silence states: `pending` / `suppressed` / `expiring` (≤15 min) / `expired` (≤2h) / `expired` (>2h) — all handled in `getEffectiveAlertState`

---

## New Cluster Parameter

If an API endpoint is cluster-specific:
1. Accept `?cluster=<name>` query parameter
2. Use `registry.Get(clusterName)` for the Alertmanager client
3. Return `404 Not Found` if cluster is not found
4. In frontend hook: include cluster name in `queryKey` for cache isolation
