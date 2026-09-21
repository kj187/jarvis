# Jarvis Architecture — Frontend State (stores, localStorage, URL, silence UI states)

Part of the architecture reference — start at `.agents/architecture.md` (index). Base rules and critical invariants live in the root `AGENTS.md`; when this file contradicts the code, the code wins.

---

## `uiStore` Interface (persisted under `jarvis-ui`)

```typescript
type ViewMode = 'card' | 'list'
type ActivePage = 'alerts' | 'silences'

interface UIStore {
  activePage: ActivePage                       // current nav tab
  viewMode: ViewMode                           // alerts view (legacy key 'jarvis-viewMode')
  activeViewMode: ViewMode                      // active-tab view (key 'jarvis-activeViewMode')
  silencesViewMode: ViewMode                    // silences view (key 'jarvis-silencesViewMode')
  isFullscreen: boolean                         // NOT persisted
  selectedFingerprint: string | null            // NOT persisted (detail panel target)
  selectedGroupKeys: string[] | null             // NOT persisted; sibling selection keys of the alert-list
                                                //   group (list/card grouped view) the current selection came
                                                //   from — null outside a group context. Set via
                                                //   setSelectedFingerprint(fp, groupKeys); drives the
                                                //   up/down group-navigation arrows in AlertDetailPanel.
  detailTab: DetailTab                          // NOT persisted (detail-panel tab; synced to `tab` URL param;
                                                //   setSelectedFingerprint/setActivePage reset it to 'details')
  filters: {
    state: string                              // default 'active'
    search: string
    labelMatchers: LabelMatcher[]
  }
  wsConnected: boolean                         // NOT persisted
  alertCounts: AlertCounts                      // { filtered, total, byState: { active, suppressed }, silenceCount }
}
// savedFilterBase: string | null — NOT persisted in jarvis-ui; sessionStorage key
//   'jarvis-saved-filter-base' (per tab, survives reload). Name of the saved filter the chips were
//   last applied/saved from, so SavedFiltersMenu can say "<name> (modified)". Hint only.
// setLabelMatchers(matchers) replaces the entire labelMatchers list with fresh ids —
// used to apply a saved filter (lib/savedFilters.ts) and to hydrate `filter` from the URL.
// URL params override persisted state on first mount; afterwards store → URL (replaceState).
// On first mount, if the URL has none of state/q/filter/alert (hasAlertViewParams), the
// saved filter marked default (findDefaultSavedFilter) is applied instead — see AlertsPage.tsx.
```

---

## Settings Store (`useSettingsStore`, persisted under `jarvis-user-settings`)

`UserSettings`, `resolveSettings`, and `normalizeSettings` live in
`lib/settingsUtils.ts` (the store re-exports them so all ~20 existing
`useSettingsStore((s) => s.theme)`-style call sites are unaffected). Default values are owned by `DEFAULT_SETTINGS` in `lib/settingsUtils.ts` and are not repeated here:

```typescript
interface UserSettings {
  theme: 'dark' | 'light'                       
  timeFormat: 'relative' | 'absolute'           
  defaultViewMode: 'card' | 'list'              
  groupByLabel: string                          // card/list grouping label
  cardColumns: 'auto' | 1 | 2 | 3 | 4 | 5 | 6    // Card view column count override
                                                 // (responsive 1/2/3/4 breakpoint, AlertCardGrid.tsx useColumns())
  savedFilters: SavedFilter[]                   // toolbar quick-select/manage menu
                                                 // { name, matchers: SavedFilterMatcher[], isDefault }
                                                 // — see `frontend-tree.md` lib/savedFilters.ts
  resolvedPageSize: 10 | 25 | 50 | 100          
  defaultSilenceDurationMinutes: number         // any integer 1…525600 (isValidSilenceDurationMinutes) — the Settings picker
                                                 // offers silenceDurations + the current value
  silenceDurations: number[]                    // minutes, ascending, 1…12 entries, each 1…525600 (365d).
                                                 // ONE list for the Fast-Silence menu (AckButton) and the Extend-silence menu.
                                                 // Layers: built-in → instance (`global`) → user.
  defaultCreatorName: string                    
  claimAnimationEnabled: boolean                
  labelDisplay: LabelDisplayConfig              // pinned (order) / hidden chips, card+list views only
  labelColors: LabelColorMap                    // label key -> palette name (LABEL_COLOR_HUES).
                                                 // Absent key = neutral (no automatic color — see
                                                 // lib/alertUtils.ts labelColorStyle).
}
```

**Storage location**: decided by whether an
authenticated user currently exists, not by `JARVIS_AUTH_MODE` — a
`write_protect` visitor who isn't logged in still edits settings freely, just
into the browser's anonymous slot (the Settings sheet is never gated behind
login). | Situation | Storage |
|---|---|
| No auth provider (`providerInfo.mode === 'none'`) | localStorage only |
| Auth provider active, logged in | DB only (`user_settings` row); localStorage keeps a read-cache mirror |
| Auth provider active, not logged in | localStorage only (anonymous slot) |

Only what a user explicitly changed is ever persisted — **sparse overrides**,
never the full resolved blob — computed as:

```typescript
resolveSettings(globalDefaults, overrides) // = { ...DEFAULT_SETTINGS, ...globalDefaults, ...overrides }
```

`globalDefaults` are the instance-wide defaults from `GET /api/v1/settings` → `global` (normalized like user settings; today only `silenceDurations`, from `JARVIS_SILENCE_DURATIONS`). The duration list is cleaned by `lib/silenceDurations.ts` (`normalizeSilenceDurations`: valid minutes only, sorted, deduplicated, capped at 12; an empty result drops the key so the next layer applies). The duration grammar (`30m 4h 1d 1w 30d 1y`) is parsed by `parseSilenceDuration` there and by `config.ParseSilenceDurations` in Go — keep the two in sync.
`useSettingsStore` extends `UserSettings` with the *resolved* flat fields
(unchanged consumer API) plus:

```typescript
overrides: Partial<UserSettings>        // source of truth for persistence
globalDefaults: Partial<UserSettings>   // instance-wide defaults (`global` from the server)
origin: 'local' | 'server'              // drives the SettingsSheet hint text
syncState: 'idle' | 'saving' | 'error'  // last PUT/DELETE outcome
anonOverrides: Partial<UserSettings>    // device's anon-slot overrides, kept across login/logout
userMirror: { id: string; overrides: Partial<UserSettings> } | null // last known server row, read cache

update(partial)   // merges into overrides; a value that matches the default-without-it is REMOVED
                  // from overrides instead of being stored, so toggling back to default doesn't cement it
reset()           // overrides = {}; server mode sends DELETE (not PUT {}), so the instance-wide defaults apply again
applyRemote(user, global, origin, userId?)  // internal — used by useSettingsSync only
setSyncState(s)   // internal — used by useSettingsSync only
```

`hooks/useSettingsSync.ts` (mounted once in `App.tsx`, next to `useWebSocket`)
is the **only** place that decides where to read/write: local mode reads
`anonOverrides` for the user's own settings and fetches only the instance defaults (`global`; skipped in full_protect until login); server mode does
`GET /api/v1/settings` via TanStack Query (`queryKey: ['settings', userId]`,
`staleTime: Infinity`), adopts the anon slot exactly once if the account has
no row yet, and registers a debounced writer (`WRITE_DEBOUNCE_MS`, `hooks/useSettingsSync.ts`) via
`setSettingsWriter()` for `PUT`/`DELETE`. The store itself never imports the
API client. A failed `GET`/`PUT`/`DELETE` never breaks the app — settings
keep working from local state and `syncState`/the SettingsSheet status line
surface the failure.

---

## localStorage Keys (complete)

`jarvis-ui` · `jarvis-viewMode` · `jarvis-activeViewMode` · `jarvis-silencesViewMode` ·
`jarvis-user-settings` (zustand `persist`, current `version` in `useSettingsStore.ts` — whole store state, so the
top-level `state.<key>` shape stays flat/backward-compatible; `migrate`
(`lib/settingsUtils.ts` `migratePersistedSettings`) runs two steps as needed: a
pre-v2 full blob into sparse `anonOverrides` via `diffFromDefaults`, then (v2 → v3)
the removed `defaultFilters` setting into a `savedFilters` entry named "Default"
via `migrateLegacyDefaultFilters` — across `overrides`/`anonOverrides`/
`userMirror.overrides` and the flat top-level copy (AGENTS.md invariant #20).
While a server identity is active this key still holds `anonOverrides`/`userMirror`
as a read cache — the DB row is authoritative, see "Settings Store" above) ·
`jarvis-username` (manual author in mode "none") ·
`jarvis_noauth_notice_dismissed` ·
`jarvis-card-section-order:<label>` · `jarvis-list-section-order:<label>`
(drag-and-drop section order per grouping label) ·
`jarvis:collapsed:<alertname>:<cluster>` (AlertCard collapse state) ·
`jarvis:collapsed:expired-silence:<fingerprint>:<cluster>` (expired-silence
banner collapse state in AlertDetailPanel, default collapsed)

sessionStorage: `jarvis-saved-filter-base` (uiStore.savedFilterBase — which saved
filter the current chips came from; per tab, so two tabs never confuse each other)

---

## URL State Params

| Param | Example | Default (not in URL) |
|---|---|---|
| `state` | `active` | `active` (always written) |
| `q` | `node` | empty |
| `filter` | `{env="prod",namespace=~"prod-.*"}` — Alertmanager matcher syntax (`lib/filterUrl.ts`) | empty — all current `labelMatchers` are serialized |
| `matchers` | legacy `[{"name":"env","operator":"=","value":"prod"}]` — still read on hydration (ignored when `filter` is present), removed from the URL on the first write | — never written |
| `alert` | `<cluster>::<fingerprint>` (URL-encoded selection key from `lib/alertSelection.ts`; legacy fingerprint-only still parsed) | empty |
| `tab` | `related` (detail-panel tab, one of `DETAIL_TABS` in `uiStore.ts` — validated via `isDetailTab`; only written when an alert is selected and the tab isn't `details`) | `details` |

**Hydration order**: URL params → store (on first mount). Afterwards: store → URL (`replaceState`). If
the URL has none of `state`/`q`/`filter`/`matchers`/`alert` at all (`lib/savedFilters.ts` `hasAlertViewParams`
— e.g. a bare `/` or `/?settings=open`), the saved filter marked default (`findDefaultSavedFilter`) is
applied on top, once, right after hydration — see "Settings Store" `savedFilters` above.

---

## Silence UI States

Silence states as rendered in the UI: `pending` / `suppressed` / `expiring`
(≤15 min) / `expired` (≤2h) / `expired` (>2h) — all derived in
`getEffectiveAlertState` (`lib/alertUtils.ts`).
