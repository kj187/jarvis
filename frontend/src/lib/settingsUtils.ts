import type { LabelMatcher, LabelMatcherOperator } from '@/types'
import { isValidSilenceDurationMinutes, normalizeSilenceDurations } from '@/lib/silenceDurations'

export const CARD_COLUMN_OPTIONS = [1, 2, 3, 4, 5, 6] as const
export type CardColumns = 'auto' | (typeof CARD_COLUMN_OPTIONS)[number]

export const RESOLVED_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
export type ResolvedPageSizeOption = (typeof RESOLVED_PAGE_SIZE_OPTIONS)[number]

const MATCHER_OPERATORS: LabelMatcherOperator[] = ['=', '!=', '=~', '!~', '>', '<']

export interface LabelDisplayConfig {
  /** Pinned label keys — rendered first, in exactly this order. */
  order: string[]
  /** Label keys collapsed behind the "+N" chip in the card/list views.
      Never also in `order` (see normalizeSettings). */
  hidden: string[]
}

/** Fixed chip color palette (name → HSL hue). Every entry has a tuned light-
    and dark-theme variant (lib/alertUtils.ts labelColorStyle), so a chosen
    color is always legible in both themes. No red — a red chip reads as a
    critical state, not a label. */
export const LABEL_COLOR_HUES = {
  blue: 217,
  cyan: 190,
  teal: 168,
  green: 142,
  amber: 43,
  orange: 25,
  pink: 330,
  purple: 270,
} as const
export type LabelColor = keyof typeof LABEL_COLOR_HUES
export const LABEL_COLORS = Object.keys(LABEL_COLOR_HUES) as LabelColor[]

/** Label key → palette color. Keys absent here have no color at all —
    labels are neutral by default, coloring is opt-in only. */
export type LabelColorMap = Record<string, LabelColor>

/** A label matcher as stored in a saved filter — the UI-only `id` is not persisted. */
export type SavedFilterMatcher = Omit<LabelMatcher, 'id'>

export interface SavedFilter {
  /** Unique (case-insensitive, trimmed) display name — also the filter's identity. */
  name: string
  /** At least one matcher; ANDed exactly like the filter bar (matchesLabelMatchers). */
  matchers: SavedFilterMatcher[]
  /** At most one saved filter is the default (see normalizeSettings). */
  isDefault: boolean
}

export const MAX_SAVED_FILTERS = 20
export const MAX_SAVED_FILTER_NAME_LENGTH = 60

export interface UserSettings {
  // Display
  theme: 'dark' | 'light'
  timeFormat: 'relative' | 'absolute'
  defaultViewMode: 'card' | 'list'
  groupByLabel: string
  // Card view column count. 'auto' keeps the responsive 1/2/3/4 breakpoint
  // behavior; a fixed number overrides it regardless of window width.
  cardColumns: CardColumns

  // Saved label filters (toolbar menu — see lib/savedFilters.ts)
  savedFilters: SavedFilter[]

  // Resolved view
  resolvedPageSize: ResolvedPageSizeOption

  // Silences
  defaultSilenceDurationMinutes: number
  // The durations (minutes, ascending) offered by the one-click Fast-Silence
  // menu and the Extend-silence menu — one list for both. Layered like every
  // setting: built-in default → instance default (JARVIS_SILENCE_DURATIONS,
  // served as `global`) → the user's own list.
  silenceDurations: number[]
  defaultCreatorName: string

  // Animations
  claimAnimationEnabled: boolean

  // Label chip display (card/list views only — see lib/alertUtils.ts partitionLabelsForDisplay)
  labelDisplay: LabelDisplayConfig

  // Per-label chip color, keyed by label key (see lib/alertUtils.ts labelColorStyle)
  labelColors: LabelColorMap
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  timeFormat: 'relative',
  defaultViewMode: 'card',
  groupByLabel: 'severity',
  cardColumns: 'auto',
  savedFilters: [],
  resolvedPageSize: 25,
  defaultSilenceDurationMinutes: 60,
  silenceDurations: [5, 10, 15, 30, 60, 240, 1440, 10080],
  defaultCreatorName: '',
  claimAnimationEnabled: true,
  labelDisplay: { order: ['@cluster'], hidden: [] },
  labelColors: {},
}

/** Layers instance-wide defaults (`global` from GET /api/v1/settings) and per-user overrides on top of the app defaults. */
export function resolveSettings(
  global: Partial<UserSettings>,
  overrides: Partial<UserSettings>,
): UserSettings {
  return { ...DEFAULT_SETTINGS, ...global, ...overrides }
}

export function isValidSavedFilterMatcher(value: unknown): value is SavedFilterMatcher {
  if (typeof value !== 'object' || value === null) return false
  const m = value as Record<string, unknown>
  return (
    typeof m.name === 'string' &&
    m.name !== '' &&
    typeof m.value === 'string' &&
    typeof m.operator === 'string' &&
    MATCHER_OPERATORS.includes(m.operator as LabelMatcherOperator)
  )
}

/** Identity of a matcher as a (name, operator, value) triple — shared by
    deduplication here and set comparison in lib/savedFilters.ts. */
export function matcherKey(m: SavedFilterMatcher): string {
  return `${m.name}\u0000${m.operator}\u0000${m.value}`
}

/** Deduplicates matchers by (name, operator, value) triple, first occurrence wins,
    and rebuilds each in the canonical { name, operator, value } key order. */
function dedupeMatchers(matchers: SavedFilterMatcher[]): SavedFilterMatcher[] {
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

/** Validates and normalizes a raw `savedFilters` array: drops malformed entries,
    malformed matchers, and duplicate names (case-insensitive) — first occurrence
    wins throughout. At most one entry keeps `isDefault: true`. Caps the result at
    MAX_SAVED_FILTERS. Never throws — the input may come from an unverified blob. */
function normalizeSavedFilters(raw: unknown[]): SavedFilter[] {
  const seenNames = new Set<string>()
  const result: SavedFilter[] = []
  let sawDefault = false

  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>

    if (typeof e.name !== 'string') continue
    const name = e.name.trim().slice(0, MAX_SAVED_FILTER_NAME_LENGTH).trim()
    if (name === '') continue
    const nameKey = name.toLowerCase()
    if (seenNames.has(nameKey)) continue

    if (!Array.isArray(e.matchers)) continue
    const matchers = dedupeMatchers(e.matchers.filter(isValidSavedFilterMatcher))
    if (matchers.length === 0) continue

    const isDefault = e.isDefault === true && !sawDefault
    if (isDefault) sawDefault = true

    seenNames.add(nameKey)
    result.push({ name, matchers, isDefault })
  }

  return result.slice(0, MAX_SAVED_FILTERS)
}

/** Legacy key from the removed non-removable "default filters" (pre saved filters). */
const LEGACY_DEFAULT_FILTERS_KEY = 'defaultFilters'
export const MIGRATED_DEFAULT_FILTER_NAME = 'Default'

/**
 * Turns the removed `defaultFilters` setting into one saved filter named
 * "Default", marked as the default. Pure and idempotent: the legacy key is
 * always removed; it is converted only when `savedFilters` is not already
 * present (a blob that has `savedFilters` was written by a release that
 * already migrated). Must run BEFORE normalizeSettings drops unknown keys —
 * see Critical Invariant #20 in AGENTS.md.
 */
export function migrateLegacyDefaultFilters(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  if (!Object.hasOwn(obj, LEGACY_DEFAULT_FILTERS_KEY)) return obj
  const { [LEGACY_DEFAULT_FILTERS_KEY]: legacy, ...rest } = obj
  if (Object.hasOwn(rest, 'savedFilters')) return rest
  if (!Array.isArray(legacy)) return rest
  const migrated = normalizeSavedFilters([
    { name: MIGRATED_DEFAULT_FILTER_NAME, matchers: legacy, isDefault: true },
  ])
  if (migrated.length === 0) return rest
  return { ...rest, savedFilters: migrated }
}

/** Keeps only known keys with a value of the expected type/range; everything
    else is dropped. Never throws — data from the server is unverified. */
export function normalizeSettings(raw: unknown): Partial<UserSettings> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const obj = migrateLegacyDefaultFilters(raw as Record<string, unknown>)
  const out: Partial<UserSettings> = {}

  if (obj.theme === 'dark' || obj.theme === 'light') {
    out.theme = obj.theme
  }
  if (obj.timeFormat === 'relative' || obj.timeFormat === 'absolute') {
    out.timeFormat = obj.timeFormat
  }
  if (obj.defaultViewMode === 'card' || obj.defaultViewMode === 'list') {
    out.defaultViewMode = obj.defaultViewMode
  }
  if (typeof obj.groupByLabel === 'string') {
    out.groupByLabel = obj.groupByLabel
  }
  if (
    obj.cardColumns === 'auto' ||
    (typeof obj.cardColumns === 'number' &&
      (CARD_COLUMN_OPTIONS as readonly number[]).includes(obj.cardColumns))
  ) {
    out.cardColumns = obj.cardColumns as CardColumns
  }
  if (Array.isArray(obj.savedFilters)) {
    out.savedFilters = normalizeSavedFilters(obj.savedFilters)
  }
  if (
    typeof obj.resolvedPageSize === 'number' &&
    (RESOLVED_PAGE_SIZE_OPTIONS as readonly number[]).includes(obj.resolvedPageSize)
  ) {
    out.resolvedPageSize = obj.resolvedPageSize as ResolvedPageSizeOption
  }
  if (isValidSilenceDurationMinutes(obj.defaultSilenceDurationMinutes)) {
    out.defaultSilenceDurationMinutes = obj.defaultSilenceDurationMinutes
  }
  if (Array.isArray(obj.silenceDurations)) {
    // An empty list would leave the menus with no buttons — drop it so the
    // next layer (instance default, then built-in) applies instead.
    const durations = normalizeSilenceDurations(obj.silenceDurations)
    if (durations.length > 0) out.silenceDurations = durations
  }
  if (typeof obj.defaultCreatorName === 'string') {
    out.defaultCreatorName = obj.defaultCreatorName
  }
  if (typeof obj.claimAnimationEnabled === 'boolean') {
    out.claimAnimationEnabled = obj.claimAnimationEnabled
  }
  if (
    typeof obj.labelDisplay === 'object' &&
    obj.labelDisplay !== null &&
    !Array.isArray(obj.labelDisplay)
  ) {
    const ld = obj.labelDisplay as Record<string, unknown>
    if (Array.isArray(ld.order) && Array.isArray(ld.hidden)) {
      const hidden = dedupeStrings(ld.hidden)
      const hiddenSet = new Set(hidden)
      // Hidden wins over order — a key configured as both never renders, so
      // keeping it in `order` too would be a dead entry.
      const order = dedupeStrings(ld.order).filter((key) => !hiddenSet.has(key))
      out.labelDisplay = { order, hidden }
    }
  }
  if (
    typeof obj.labelColors === 'object' &&
    obj.labelColors !== null &&
    !Array.isArray(obj.labelColors)
  ) {
    out.labelColors = normalizeLabelColors(obj.labelColors as Record<string, unknown>)
  }

  return out
}

/** Keeps only entries with a non-empty key and a known palette color name. */
function normalizeLabelColors(raw: Record<string, unknown>): LabelColorMap {
  const out: LabelColorMap = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key === '' || typeof value !== 'string' || !Object.hasOwn(LABEL_COLOR_HUES, value)) continue
    out[key] = value as LabelColor
  }
  return out
}

/** Non-string and empty-string entries dropped; duplicates removed, first occurrence wins. */
function dedupeStrings(values: unknown[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== 'string' || value === '' || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

/** Diffs a full (pre-v2) settings blob against the app defaults, keeping only
    the keys that actually deviate — used once by the persist `migrate` step
    that turns the old full-blob format into sparse overrides. */
export function diffFromDefaults(full: Partial<UserSettings>): Partial<UserSettings> {
  const out: Partial<UserSettings> = {}
  ;(Object.keys(DEFAULT_SETTINGS) as (keyof UserSettings)[]).forEach((key) => {
    if (!(key in full)) return
    const value = full[key]
    if (JSON.stringify(value) !== JSON.stringify(DEFAULT_SETTINGS[key])) {
      out[key] = value as never
    }
  })
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

/**
 * The zustand `persist` `migrate` step for the `jarvis-user-settings` store.
 * Pulled out of the store definition so it is unit-testable under
 * `src/lib/**`. Runs the legacy `defaultFilters` → `savedFilters` migration
 * (Critical Invariant #20) BEFORE `diffFromDefaults`, which only walks
 * `DEFAULT_SETTINGS` keys and would otherwise silently drop the legacy key.
 */
export function migratePersistedSettings(persisted: unknown, version: number): unknown {
  let state = asRecord(persisted)

  if (version < 2) {
    // Pre-v2: full resolved blob at top level, no override/mirror bookkeeping.
    // Route through normalizeSettings (not just migrateLegacyDefaultFilters)
    // so every field gets the same shape validation the server-settings path
    // already has — a malformed nested value (e.g. labelDisplay missing
    // `order`, from a hand-edited or otherwise corrupted localStorage blob)
    // must be dropped here, not carried into overrides where it would crash
    // partitionLabelsForDisplay on every render.
    const anonOverrides = diffFromDefaults(normalizeSettings(state))
    state = {
      ...resolveSettings({}, anonOverrides),
      overrides: anonOverrides,
      globalDefaults: {},
      origin: 'local',
      syncState: 'idle',
      anonOverrides,
      userMirror: null,
    }
  }

  if (version < 3) {
    const rest = { ...state }
    delete rest[LEGACY_DEFAULT_FILTERS_KEY] // drop the flat resolved copy
    const overrides = migrateLegacyDefaultFilters(asRecord(rest.overrides))
    const anonOverrides = migrateLegacyDefaultFilters(asRecord(rest.anonOverrides))
    const mirror = rest.userMirror
    const userMirror =
      isRecord(mirror) && typeof mirror.id === 'string'
        ? { id: mirror.id, overrides: migrateLegacyDefaultFilters(asRecord(mirror.overrides)) }
        : null
    const globalDefaults = asRecord(rest.globalDefaults)
    state = {
      ...rest,
      ...resolveSettings(
        globalDefaults as Partial<UserSettings>,
        overrides as Partial<UserSettings>,
      ),
      overrides,
      anonOverrides,
      userMirror,
      globalDefaults,
    }
  }

  return state
}
