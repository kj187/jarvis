# Jarvis Tests — Frontend Strategy

Part of the test reference — start at `.agents/testing.md` (index: commands, `make verify`, pre-commit, CI). Base rules live in the root `AGENTS.md`; when this file contradicts the code, the code wins.

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
- `frontend/src/lib/themeTokens.test.ts` — reads `src/index.css` and asserts
  that `--color-ring` reaches >= 3:1 contrast against every surface token
  (background/card/header/input/muted/accent) and `--color-control` (text-field
  edge, `border-control`) against background/card/header/input, in dark and
  light (WCAG 2.2 SC 1.4.11 / 2.4.11). Outside the coverage scope; extend it
  for further token pairs. Also asserts `--color-muted-foreground` >= 4.5:1 on every
  surface and 4.5:1 text contrast for every status role. Browser-level checks live in
  `e2e/functional/none/a11y.spec.ts` (axe on Alerts and Silences, both themes, no rule
  excluded; keyboard path into the alert card and through the Fast-Silence popover; Enter
  inside a list row; reduced motion). `alert-ack.spec.ts` additionally asserts that the
  "Silence…" entry's bell sits within 2px of the trigger's bell — measured layout, not just
  "on screen".
- `frontend/src/lib/alertUtils.test.ts` — example-based tests for every
  exported function (formatting/escaping helpers, matching/state functions),
  including the byte-mirrored Resolved-filter corpus from
  `src/lib/testdata/resolved-filter-conformance.json` (shared expectations
  plus explicit JavaScript-RegExp/RE2 and serialized-JSON-search differences),
  plus `fast-check` property tests (e.g. "regex built from
  `escapeRegexValue` matches only the original literal"; "every label
  `computeGroupLabelValues` returns is present on every input alert").
  Includes `partitionLabelsForDisplay` (label display config, issue #189):
  empty-config alphabetical ordering with `HIDDEN_LABEL_KEYS` dropped,
  pinned-keys-first placement, silently skipping an absent pinned or hidden
  key, `hidden` moving a key into the `hidden` partition, hidden-wins when a
  key is in both `order` and `hidden`, `HIDDEN_LABEL_KEYS`/`__`-prefixed keys
  in neither partition even if configured, the `exclude` set applying to both
  partitions, hidden labels sorted alphabetically, the default
  `{ order: ['@cluster'], hidden: [] }` config (no visual regression), and
  determinism under different input key insertion order. Also
  `labelColorStyle`: `undefined` for an uncolored key or a non-palette value,
  the exact per-theme HSL style for a palette hue, and a style for every
  palette color in both themes.
- **100% coverage gate on `alertUtils.ts`** (statements/lines/functions;
  branches at 99% — the one excluded branch is `tzAbbr`'s `Intl`-dependent
  fallback, not practically testable without mocking `Date`/`Intl` for a
  cosmetic display value). Enforced by `pnpm test:unit:coverage` /
  `make test-frontend-unit`, in pre-commit and CI — a new function or branch
  added to this file needs a test in the same commit or the build fails.
- `frontend/src/lib/settingsUtils.test.ts` — same `src/lib/**` inclusion, same
  rationale (pure resolution/validation logic, not a UI flow): `resolveSettings`
  layering, `normalizeSettings` dropping unknown keys/out-of-range values from
  an unverified server blob, and `diffFromDefaults`
  (the pre-v2 → sparse-overrides migration step). Includes `labelDisplay`
  normalization (issue #189): malformed input (non-object, `order`/`hidden`
  not both arrays) drops the whole key, non-string/empty-string array entries
  are dropped, duplicates within `order` are removed, a key present in both
  `order` and `hidden` survives only in `hidden`, and a valid config
  round-trips through `normalizeSettings` unchanged; `labelColors` keeps only
  non-empty keys with a known palette name (and round-trips) — the round-trip
  tests guard the
  server read path (`hooks/useSettingsSync.ts`) specifically, since the local
  (`none` auth mode) path never normalizes at all. Also `savedFilters`
  normalization (name trim/cap/dedupe case-insensitively, matcher validation,
  extra fields like `id`/`locked` stripped, matcher dedup, at most one
  `isDefault: true`, capped at `MAX_SAVED_FILTERS`, and a valid config
  round-trips including key order) and the `defaultFilters` → `savedFilters`
  legacy migration (`migrateLegacyDefaultFilters`, AGENTS.md invariant #20):
  converts a legacy blob into one saved filter named "Default" marked as
  default, is a no-op without the legacy key, drops it without adding
  `savedFilters` for an empty/invalid legacy value, `savedFilters` wins
  unchanged when both keys are present, is idempotent, and
  `normalizeSettings` itself migrates a raw `defaultFilters` blob (the guard
  for the server read path, since `normalizeSettings` is the only place that
  normalizes). `migratePersistedSettings` (the store's `persist` `migrate`,
  extracted here for unit-testability) is tested end-to-end for a v0 flat
  blob, a v2 state with the legacy key in `overrides`/`anonOverrides`/
  `userMirror.overrides`/flat top-level, a v2 state with no legacy key
  (unchanged), and `null`/non-object input (no throw). **Not** under the 100%
  coverage gate — that stays scoped to `alertUtils.ts` only (`vitest.config.ts`
  `coverage.include`).
- `frontend/src/lib/savedFilters.test.ts` — list/comparison helpers for saved
  filters (`toSavedFilterMatchers`, `matcherListsEqual`, `findActiveSavedFilter`,
  `findDefaultSavedFilter`, `validateSavedFilterName`, the `addSavedFilter`/
  `renameSavedFilter`/`replaceSavedFilterMatchers`/`deleteSavedFilter`/
  `toggleDefaultSavedFilter` list operations, `hasAlertViewParams`,
  `resolveSavedFilterStatus` — empty with or without a base, saved regardless
  of the base, modified only while the base still exists, unsaved without a
  base or with a base name that no longer exists). Kept out
  of `alertUtils.ts` — it never evaluates an alert (Critical Invariant #4 stays
  with `matchesLabelMatchers`), so it doesn't extend that file's 100% coverage
  gate. Covers set-equality independent of order/duplicates, first-match /
  no-match lookups, name validation (empty, case-insensitive duplicate, a
  case-only rename via `exceptName`), that every list operation touches only
  its target and that its result round-trips through `normalizeSettings`
  unchanged, and `hasAlertViewParams` for each of `state`/`q`/`matchers`/`filter`/
  `alert` vs. an empty query or `settings=open` alone.
- `frontend/src/lib/alertLink.test.ts` — `buildAlertShareUrl`: only `state` + `alert` in the link, alert identity round-trips (incl. cluster names needing escaping), resolved → `state=resolved`, suppressed/unprocessed → `active`, sub-path deployments.
- `frontend/src/lib/filterUrl.test.ts` — `?filter=` URL serialization in
  Alertmanager matcher syntax: `formatMatchers` (all six operators, bare
  pseudo-label names, quoted/escaped values and reserved-char names),
  `parseMatchers` (hand-written variants without braces / with whitespace /
  unquoted values / trailing comma, escapes, a table of malformed inputs →
  `null`) plus a fast-check round-trip property over arbitrary matcher lists,
  and `readUrlMatchers` (`filter` wins over legacy JSON `matchers`, invalid
  legacy entries dropped, empty/malformed → `null`). Not under the coverage
  gate either — serialization, not filtering (Invariant #4).

This does **not** reopen the door to a general component-test stack —
anything outside `src/lib/` stays E2E-only.

Specs live under `frontend/e2e/`:

- `e2e/functional/<mode>/*.spec.ts` — functional golden paths per auth mode (`none`, `internal`, `oidc`).
  `functional/none/alerts-overview.spec.ts` also guards the shared modal-dialog
  accessibility contract: accessible name, focus moved inside on open,
  Tab/Shift+Tab containment, Escape close, and focus restoration to the trigger.
  `functional/none/settings.spec.ts` includes H12: opening Settings writes
  `settings=open`, a reload reopens the sheet, and closing it removes only
  that parameter while preserving alert-page URL state.
  `functional/none/label-display.spec.ts` (issue #189, L1–L14): hiding a label
  via the eye toggle removes its chip from the card view (L1) and the list view
  (L2); a hidden label stays fully visible in the alert detail panel — the
  guard for invariant #19 (L3); pinning a label and dragging it above
  `@cluster` makes it the first chip — simulated with raw `page.mouse` events
  against the grip handle (L4); pin and hide are mutually exclusive, in the UI
  and in the stored `labelDisplay` (L5); the search box filters the whole label
  list in real time and the drag grip returns once it's cleared (L6); hiding a
  label keeps its alphabetical position (L7); the "+N" chip opens that
  alert's hidden labels in a floating popover without changing the card's
  own height — verified by comparing its bounding box before/after — and
  dismisses on a second click or an outside click (L8); "Reset all settings"
  restores every chip and the original order (L9); a palette color applies to
  the chip, is stored by name, and can be removed again (L10); "Reset labels"
  resets only `labelDisplay` and `labelColors` after its second confirmation
  click, leaving `defaultViewMode` untouched (L11); a configured label stays
  editable while no alert carries it (L12); "Hide all" / "Show all" toggles
  every unpinned label but never a pinned one, and the card collapses them
  into one "+N" chip that opens the same floating popover (L13), and only
  touches the unpinned labels matching an active search (L14). Deliberately **no**
  `internal`-mode spec for server-side persistence
  of this setting — the persistence path is already proven generically (any
  key) by `internal/settings-persistence.spec.ts` (updated for the "Reset
  all settings" button rename), since the settings backend is an opaque blob
  with no per-key code path; the one `labelDisplay`-specific piece
  (normalization) is covered by `settingsUtils.test.ts` instead, at the
  cheaper Vitest tier.
  `functional/none/saved-filters.spec.ts` (K1–K13, replaces the removed
  "Default Filter" Settings section): saving the current chips under a name
  and seeing the row appear as active (K1); applying a saved filter replaces
  the matchers but leaves search untouched, and the URL reflects the new
  matchers — the alert detail panel is a full-viewport modal (Sheet) whose
  backdrop blocks every other toolbar interaction while open, a pre-existing
  behavior unrelated to this feature, so applying happens with no alert
  selected; `setLabelMatchers` (uiStore.ts) only ever touches
  `filters.labelMatchers`, so it cannot itself clear a selection (K2); after
  removing a loaded filter's only chip and adding a different one, the CLOSED
  button still names the base ("Critical", via
  `saved-filters-menu-label`), shows the unsaved dot and a "changed, not saved
  yet" title, the popover marks the base row "modified" and offers no
  one-click overwrite on other rows, and "Save changes to Critical" writes the
  new matchers (K3 — it also guards that an empty chip list keeps the base);
  renaming flags a case-insensitive duplicate while typing with the confirm
  button disabled, Esc cancels without closing the popover, Enter commits
  (K4); deleting needs a second confirming click and never touches the
  current chips (K5); the saved filter marked default is applied only when
  the URL carries none of `state`/`q`/`matchers`/`alert` — not on a reload
  (which always has `state`) and not on top of an explicit shared link (K6);
  a default filter's chips are ordinary, removable chips and the removal
  survives a reload (K7); a legacy `defaultFilters` blob (`version: 2`, spread
  across `overrides`/`anonOverrides`) is migrated into a saved filter named
  "Default" through the real store on load, and the persisted blob no longer
  contains the string `defaultFilters` afterwards (K8, guards AGENTS.md
  invariant #20); the save row is replaced by a hint when the current filter
  is empty or already saved, and the empty case shows no unsaved dot (K9);
  "Reset all settings" clears saved filters (K10); the unsaved dot also
  appears for a filter built from scratch (K11); the "modified" state and its
  base survive a reload of the same tab (sessionStorage), "save as new" via
  Enter leaves the base untouched and becomes active, and re-applying a
  filter replaces the chips again (K12); with no known base, overwriting
  another saved filter from its row writes nothing on the first click and
  only overwrites after "Click again to overwrite" (K13).
- `e2e/screenshots/<mode>/*.screenshot.spec.ts` — screenshot generation for docs (`docs/assets/`)
- `e2e/video/` — demo-video recorder, renderer, release and intro storyboard templates (`playwright.video.config.ts`; per-project storyboards in gitignored `e2e/_video/`; `.agents/skills/release-video/SKILL.md`). Not a test and not run in CI.
- `e2e/fixtures/`, `e2e/support/` — shared fixtures and helpers

The complete spec inventory (which spec file covers which scenario), the
container stack architecture, fixture setup, auth-mode details, and
troubleshooting are documented in **`docs/testing-e2e.md`**.
