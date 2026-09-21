# Jarvis — Architecture Reference (index)

Architecture knowledge is split by topic so a task loads only what it needs.
Start here, open the matching file(s) under `.agents/architecture/`, and load
nothing else. Base rules and critical invariants live in the root `AGENTS.md`.
When a file contradicts the code, the code wins — fix the file in the same
commit (AGENTS.md → Workflow Rules #6).

The rendered who-talks-to-whom data-flow diagram lives in
`docs/architecture.md` (source: `docs/diagrams/architecture-data-flow.mmd`,
re-render via `make diagrams`) — keep it in sync when the topology changes
(AGENTS.md workflow rule 12). Env vars are documented only in
`docs/configuration.md`, metrics in `docs/metrics.md`, HA design in
`docs/postgres-ha.md`.

## Which file for which task

| Task / question | Load |
|---|---|
| Go model fields and semantics, DB tables/columns/indexes, migrations | `.agents/architecture/data-model.md` |
| API endpoints (auth level, rate limits, behaviour), WebSocket events, auth providers and roles, config/metrics coupling notes | `.agents/architecture/api.md` |
| Alert lifecycle state machine, recorder/history, retention sweeper, leader/snapshot/fanout code map, pod label, Alertmanager HA member deduplication | `.agents/architecture/history-and-ha.md` |
| Frontend shell, `store/`, `hooks/`, `lib/` (what each file owns) | `.agents/architecture/frontend-tree.md` |
| Frontend `components/` (per-component behaviour and constraints) | `.agents/architecture/frontend-components.md` |
| `uiStore`, `useSettingsStore` shape, localStorage keys, URL state params, silence UI states | `.agents/architecture/frontend-state.md` |

Cross-cutting questions usually need two files (for example a new endpoint:
`api.md` + `data-model.md`; a new alert-list feature: `frontend-tree.md` +
`frontend-components.md`). Grep the directory for a symbol before reading a
whole file.

Which file to update after a change: `.agents/doc-sync.md`.

---

## Technology Decisions

| Decision | Why |
|---|---|
| `modernc.org/sqlite` + `pgx/v5` | Both are pure Go — no C compiler needed in container build (Podman/distroless) |
| `JARVIS_DB_DSN` selects dialect | Prefix `postgres://` → PostgreSQL via `pgx/v5/stdlib`; anything else → SQLite file path |
| No CGO | Container build with `CGO_ENABLED=0`, distroless final image has no C runtime |
| `//go:build prod` tag | `embed.FS` cannot compile a non-existent `dist/` directory — two files (prod/!prod) instead of one |
| TanStack Query WS patching | WS events patch the cache directly (`setQueryData`) — no extra refetch round-trip |
| Zustand v5 with `persist` | `viewMode` + `filters` persisted in localStorage, but URL params take precedence |
| Fixed palette for label chip colors | Settings store a color *name* (`LABEL_COLOR_HUES`); `labelColorStyle` derives a tuned background/text/border per theme from its hue, so every chip color stays legible in light and dark theme |
