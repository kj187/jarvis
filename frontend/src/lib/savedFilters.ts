import type { LabelMatcher } from '@/types'
import { matcherKey } from '@/lib/settingsUtils'
import type { SavedFilter, SavedFilterMatcher } from '@/lib/settingsUtils'
import { FILTER_PARAM, LEGACY_MATCHERS_PARAM } from '@/lib/filterUrl'

/**
 * List and comparison helpers for saved label filters (toolbar menu — see
 * components/alerts/SavedFiltersMenu.tsx). This is deliberately NOT filtering
 * logic: it never evaluates an alert, so it stays out of `lib/alertUtils.ts`
 * (Critical Invariant #4 — `matchesLabelMatchers` remains the only label
 * filter semantics — and out of alertUtils.ts's 100% coverage gate, which is
 * not being widened for list management). `lib/settingsUtils.ts` keeps the
 * types, normalization and migration; this module builds on top of it.
 */

/** Strips the runtime-only `id`, drops exact duplicates (first wins), and
    rebuilds every matcher in the canonical { name, operator, value } key
    order (settingsUtils.ts builds saved filters in the same order). */
export function toSavedFilterMatchers(
  matchers: readonly Omit<LabelMatcher, 'id'>[],
): SavedFilterMatcher[] {
  const seen = new Set<string>()
  const result: SavedFilterMatcher[] = []
  for (const m of matchers) {
    const key = matcherKey(m)
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ name: m.name, operator: m.operator, value: m.value })
  }
  return result
}

/** Set equality of (name, operator, value) triples — order- and
    duplicate-insensitive, matching that matchers are ANDed together. This is
    NOT a filter: it never evaluates an alert against these matchers. */
export function matcherListsEqual(
  a: readonly Omit<LabelMatcher, 'id'>[],
  b: readonly Omit<LabelMatcher, 'id'>[],
): boolean {
  const setA = new Set(a.map(matcherKey))
  const setB = new Set(b.map(matcherKey))
  if (setA.size !== setB.size) return false
  for (const key of setA) {
    if (!setB.has(key)) return false
  }
  return true
}

/** The first saved filter whose matchers equal the current ones as a set.
    Returns null when the current filter is empty or no saved filter matches. */
export function findActiveSavedFilter(
  current: readonly LabelMatcher[],
  saved: readonly SavedFilter[],
): SavedFilter | null {
  if (current.length === 0) return null
  return saved.find((f) => matcherListsEqual(current, f.matchers)) ?? null
}

/** The one saved filter marked as default, if any (normalizeSettings
    guarantees there is at most one). */
export function findDefaultSavedFilter(saved: readonly SavedFilter[]): SavedFilter | null {
  return saved.find((f) => f.isDefault) ?? null
}

/**
 * How the current chips relate to the saved filters — drives the menu
 * button's label, the unsaved dot and which save/update actions the popover
 * offers:
 *   - `empty`:    no chips at all — nothing to save.
 *   - `saved`:    the chips equal a saved filter (as a set).
 *   - `modified`: the chips differ from every saved filter, but the user last
 *                 applied/saved `base` (still present) — "changes to base not saved".
 *   - `unsaved`:  the chips differ from every saved filter and there's no
 *                 usable base (built from scratch, shared link, base deleted).
 * `baseName` is only a hint (uiStore.savedFilterBase); a name that no longer
 * exists is ignored rather than trusted.
 */
export type SavedFilterStatus =
  | { kind: 'empty' }
  | { kind: 'saved'; filter: SavedFilter }
  | { kind: 'modified'; base: SavedFilter }
  | { kind: 'unsaved' }

export function resolveSavedFilterStatus(
  current: readonly LabelMatcher[],
  saved: readonly SavedFilter[],
  baseName: string | null,
): SavedFilterStatus {
  if (current.length === 0) return { kind: 'empty' }
  const active = findActiveSavedFilter(current, saved)
  if (active) return { kind: 'saved', filter: active }
  const base = baseName === null ? undefined : saved.find((f) => f.name === baseName)
  return base ? { kind: 'modified', base } : { kind: 'unsaved' }
}

/**
 * Validates a candidate saved-filter name against the existing list.
 * `exceptName` excludes the filter currently being renamed, so renaming
 * "Prod" to "PROD" (a case-only change) is not rejected as a duplicate of
 * itself.
 */
export function validateSavedFilterName(
  saved: readonly SavedFilter[],
  name: string,
  exceptName?: string,
): 'empty' | 'duplicate' | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'empty'
  const key = trimmed.toLowerCase()
  const exceptKey = exceptName?.trim().toLowerCase()
  const duplicate = saved.some((f) => f.name.toLowerCase() === key && f.name.toLowerCase() !== exceptKey)
  return duplicate ? 'duplicate' : null
}

// ── List operations ──────────────────────────────────────────────────────────
// All return a NEW array of { name, matchers, isDefault } objects; callers
// are expected to validate first (validateSavedFilterName). These never throw.

/** Appends a new saved filter (not the default) built from the current matchers. */
export function addSavedFilter(
  saved: readonly SavedFilter[],
  name: string,
  matchers: readonly Omit<LabelMatcher, 'id'>[],
): SavedFilter[] {
  return [
    ...saved,
    { name: name.trim(), matchers: toSavedFilterMatchers(matchers), isDefault: false },
  ]
}

/** Renames the saved filter with the given name; every other field is kept. */
export function renameSavedFilter(
  saved: readonly SavedFilter[],
  name: string,
  nextName: string,
): SavedFilter[] {
  const trimmed = nextName.trim()
  return saved.map((f) => (f.name === name ? { ...f, name: trimmed } : f))
}

/** Overwrites the matchers of the saved filter with the given name. */
export function replaceSavedFilterMatchers(
  saved: readonly SavedFilter[],
  name: string,
  matchers: readonly Omit<LabelMatcher, 'id'>[],
): SavedFilter[] {
  return saved.map((f) => (f.name === name ? { ...f, matchers: toSavedFilterMatchers(matchers) } : f))
}

/** Removes the saved filter with the given name. */
export function deleteSavedFilter(saved: readonly SavedFilter[], name: string): SavedFilter[] {
  return saved.filter((f) => f.name !== name)
}

/** Toggles the default flag on the saved filter with the given name: if it
    isn't the default, it becomes the only default; if it already is, the
    default is cleared entirely (no saved filter left as default). */
export function toggleDefaultSavedFilter(saved: readonly SavedFilter[], name: string): SavedFilter[] {
  const target = saved.find((f) => f.name === name)
  const makeDefault = target ? !target.isDefault : false
  return saved.map((f) => ({ ...f, isDefault: makeDefault && f.name === name }))
}

/** True when the URL query carries any alert-view parameter (state, q,
    filter or legacy matchers, alert) — in that case the URL is authoritative and the default
    saved filter must not be applied on top of it. `settings=open` does not
    count: it belongs to the shell (Header.tsx), not the alert view. */
export function hasAlertViewParams(search: string): boolean {
  const params = new URLSearchParams(search)
  return (
    params.has('state') ||
    params.has('q') ||
    params.has(FILTER_PARAM) ||
    params.has(LEGACY_MATCHERS_PARAM) ||
    params.has('alert')
  )
}
