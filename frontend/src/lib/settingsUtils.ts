import type { LabelMatcherOperator } from '@/types'

export interface DefaultFilter {
  name: string
  operator: LabelMatcherOperator
  value: string
}

export const CARD_COLUMN_OPTIONS = [1, 2, 3, 4, 5, 6] as const
export type CardColumns = 'auto' | (typeof CARD_COLUMN_OPTIONS)[number]

export const RESOLVED_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
export type ResolvedPageSizeOption = (typeof RESOLVED_PAGE_SIZE_OPTIONS)[number]

export const ALLOWED_SILENCE_DURATIONS = [15, 30, 60, 240, 480, 1440, 4320] as const

const DEFAULT_FILTER_OPERATORS: LabelMatcherOperator[] = ['=', '!=', '=~', '!~']

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

export interface UserSettings {
  // Display
  theme: 'dark' | 'light'
  timeFormat: 'relative' | 'absolute'
  defaultViewMode: 'card' | 'list'
  groupByLabel: string
  // Card view column count. 'auto' keeps the responsive 1/2/3/4 breakpoint
  // behavior; a fixed number overrides it regardless of window width.
  cardColumns: CardColumns

  // Default filter (locked, always present in header)
  defaultFilters: DefaultFilter[]

  // Resolved view
  resolvedPageSize: ResolvedPageSizeOption

  // Silences
  defaultSilenceDurationMinutes: number
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
  defaultFilters: [],
  resolvedPageSize: 25,
  defaultSilenceDurationMinutes: 60,
  defaultCreatorName: '',
  claimAnimationEnabled: true,
  labelDisplay: { order: ['@cluster'], hidden: [] },
  labelColors: {},
}

/** Layers instance-wide defaults (reserved, {} for now) and per-user overrides on top of the app defaults. */
export function resolveSettings(
  global: Partial<UserSettings>,
  overrides: Partial<UserSettings>,
): UserSettings {
  return { ...DEFAULT_SETTINGS, ...global, ...overrides }
}

function isValidDefaultFilter(value: unknown): value is DefaultFilter {
  if (typeof value !== 'object' || value === null) return false
  const f = value as Record<string, unknown>
  return (
    typeof f.name === 'string' &&
    typeof f.value === 'string' &&
    typeof f.operator === 'string' &&
    DEFAULT_FILTER_OPERATORS.includes(f.operator as LabelMatcherOperator)
  )
}

/** Keeps only known keys with a value of the expected type/range; everything
    else is dropped. Never throws — data from the server is unverified. */
export function normalizeSettings(raw: unknown): Partial<UserSettings> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const obj = raw as Record<string, unknown>
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
  if (Array.isArray(obj.defaultFilters)) {
    out.defaultFilters = obj.defaultFilters.filter(isValidDefaultFilter)
  }
  if (
    typeof obj.resolvedPageSize === 'number' &&
    (RESOLVED_PAGE_SIZE_OPTIONS as readonly number[]).includes(obj.resolvedPageSize)
  ) {
    out.resolvedPageSize = obj.resolvedPageSize as ResolvedPageSizeOption
  }
  if (
    typeof obj.defaultSilenceDurationMinutes === 'number' &&
    (ALLOWED_SILENCE_DURATIONS as readonly number[]).includes(obj.defaultSilenceDurationMinutes)
  ) {
    out.defaultSilenceDurationMinutes = obj.defaultSilenceDurationMinutes
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
