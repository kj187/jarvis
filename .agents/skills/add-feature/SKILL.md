---
name: add-feature
description: TDD workflow and checklist for adding a new backend endpoint, frontend component, WS event, or cluster parameter to Jarvis. Use before building a new feature.
---

# Jarvis — Adding a New Feature

TDD workflow + conventions checklist for new features. Base rules (TDD in the
same commit, type sync, commit format, critical invariants) live in the root
`AGENTS.md` — this file adds the step-by-step detail. For the data model, API
surface, and component tree, load `.agents/architecture.md` (index) and the
topic file it names.

---

## Step 0 — Scope Gate (before any code)

Check the feature against `docs/scope.md` (litmus test: *"does this help
someone sitting in front of a list of active alerts who has to decide what
to do?"*). Out of scope or borderline → tell the user why and stop until
they decide (AGENTS.md → Workflow Rules #11).

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
1. Add type in types/index.ts (mirrors Go model exactly) and, if the feature
   needs a new endpoint, its wrapper in api/client.ts — declarations only
2. Write the failing test first, from the behaviour you want: hook/lib unit
   test, component test, or (for the golden path) a Playwright functional E2E
   (docs/testing-e2e.md). Run it and observe it fail (Red) for the right reason
3. Implement to green: TanStack Query hook in hooks/useXyz.ts, then the
   component (frontend checklist in AGENTS.md → Workflow Rules #4); it is a
   visual change, so load `.agents/skills/design-system/SKILL.md` — semantic
   tokens only, a primitive per overlay role, both themes, keyboard, states
4. Run the test again (Green), then `pnpm build`
```

Implementation and its tests land in the **same commit**.

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
   documented in `.agents/architecture/frontend-state.md` — all handled in
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

---

## Last Step — Documentation (not optional)

A feature is not done until the docs describe it. Do this in the **same
commit** as the feature, at the latest before the PR is merged — the
documentation website publishes `docs/` on every push to `main`, so a
missing update ships as stale documentation.

1. **User-visible behavior** → update `docs/features.md` (and the matching
   `docs/*.md` for auth, retention, metrics, persistence, security). New
   screenshot needed? `make e2e-screenshot NAME=<test-name>`
   (`docs/testing-e2e.md`).
2. **New file under `docs/`** → load `.agents/skills/website/SKILL.md` and
   register it: entry in `website/scripts/pages.mjs` **and** a sidebar link
   in `website/.vitepress/config.mts`. Without both it is invisible on the
   site, and links to it break the build.
3. **AI context** → the mapping in `.agents/doc-sync.md` (AGENTS.md →
   Workflow Rules #6): new endpoint/model/env var (a new page, store or hook family for the component tree) → the matching
   file under `.agents/architecture/`, and so on.
4. `make website` must stay green — it fails on dead internal links.

