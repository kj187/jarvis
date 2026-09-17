import { describe, expect, it } from 'vitest'
import {
  resolveSettings,
  normalizeSettings,
  diffFromDefaults,
  migrateLegacyDefaultFilters,
  migratePersistedSettings,
  MIGRATED_DEFAULT_FILTER_NAME,
  DEFAULT_SETTINGS,
} from './settingsUtils'
import type { SavedFilter } from './settingsUtils'

describe('resolveSettings', () => {
  it('returns DEFAULT_SETTINGS when nothing is set', () => {
    expect(resolveSettings({}, {})).toEqual(DEFAULT_SETTINGS)
  })

  it('layers override over global over app default', () => {
    const resolved = resolveSettings({ theme: 'light', cardColumns: 3 }, { theme: 'dark' })
    expect(resolved.theme).toBe('dark') // override wins
    expect(resolved.cardColumns).toBe(3) // global wins over app default
    expect(resolved.timeFormat).toBe(DEFAULT_SETTINGS.timeFormat) // untouched
  })
})

describe('normalizeSettings', () => {
  it.each([null, 'x', [], 42])('returns {} for non-object input %j', (input) => {
    expect(normalizeSettings(input)).toEqual({})
  })

  it('drops unknown keys', () => {
    expect(normalizeSettings({ theme: 'light', totallyUnknown: 'x' })).toEqual({ theme: 'light' })
  })

  it.each([
    ['theme', 'neon'],
    ['resolvedPageSize', 7],
    ['cardColumns', 99],
    ['defaultSilenceDurationMinutes', 13],
  ])('drops invalid value for %s', (key, value) => {
    const result = normalizeSettings({ [key]: value }) as Record<string, unknown>
    expect(result[key]).toBeUndefined()
  })

  it.each([
    ['nope'],
    [{ order: 'x' }],
  ])('drops labelDisplay for malformed input %j', (value) => {
    expect(normalizeSettings({ labelDisplay: value })).toEqual({})
  })

  it('drops non-string and empty-string entries from labelDisplay arrays', () => {
    const result = normalizeSettings({
      labelDisplay: { order: ['customer', 42, '', null], hidden: ['dbid', '', 7] },
    })
    expect(result.labelDisplay).toEqual({ order: ['customer'], hidden: ['dbid'] })
  })

  it('removes duplicates within labelDisplay.order, keeping the first occurrence', () => {
    const result = normalizeSettings({
      labelDisplay: { order: ['customer', 'hostname', 'customer'], hidden: [] },
    })
    expect(result.labelDisplay).toEqual({ order: ['customer', 'hostname'], hidden: [] })
  })

  it('a key in both order and hidden ends up only in hidden', () => {
    const result = normalizeSettings({
      labelDisplay: { order: ['customer', 'dbid'], hidden: ['dbid'] },
    })
    expect(result.labelDisplay).toEqual({ order: ['customer'], hidden: ['dbid'] })
  })

  it('a valid labelDisplay config survives normalizeSettings unchanged (round-trip)', () => {
    const config = { order: ['customer', 'hostname'], hidden: ['dbid'] }
    const result = normalizeSettings({ labelDisplay: config })
    expect(result.labelDisplay).toEqual(config)
  })

  it.each([
    ['nope'],
    [['not', 'an', 'object']],
  ])('drops labelColors for malformed input %j', (value) => {
    expect(normalizeSettings({ labelColors: value })).toEqual({})
  })

  it('keeps only entries with a non-empty key and a known palette color', () => {
    const result = normalizeSettings({
      labelColors: {
        customer: 'blue',
        '': 'blue',
        hostname: '#3b82f6',
        dbid: 'red',
        job: 123,
        team: 'toString',
      },
    })
    expect(result.labelColors).toEqual({ customer: 'blue' })
  })

  it('a valid labelColors map survives normalizeSettings unchanged (round-trip)', () => {
    const colors = { customer: 'blue', hostname: 'amber', team: 'purple' }
    expect(normalizeSettings({ labelColors: colors })).toEqual({ labelColors: colors })
  })

  // ── savedFilters normalization ───────────────────────────────────────────────

  it.each([
    ['x'],
    [{}],
  ])('drops savedFilters key for non-array input %j', (value) => {
    expect(normalizeSettings({ savedFilters: value })).toEqual({})
  })

  it('keeps an empty savedFilters array', () => {
    expect(normalizeSettings({ savedFilters: [] })).toEqual({ savedFilters: [] })
  })

  it('drops non-object entries and entries with a missing/empty name', () => {
    const result = normalizeSettings({
      savedFilters: [
        'not-an-object',
        { name: '', matchers: [{ name: 'severity', operator: '=', value: 'critical' }], isDefault: false },
        { name: '   ', matchers: [{ name: 'severity', operator: '=', value: 'critical' }], isDefault: false },
        { matchers: [{ name: 'severity', operator: '=', value: 'critical' }], isDefault: false },
      ],
    })
    expect(result.savedFilters).toEqual([])
  })

  it('trims the name and caps it at MAX_SAVED_FILTER_NAME_LENGTH (60)', () => {
    const longName = 'x'.repeat(80)
    const result = normalizeSettings({
      savedFilters: [
        { name: `  ${longName}  `, matchers: [{ name: 'a', operator: '=', value: 'b' }], isDefault: false },
      ],
    })
    expect((result.savedFilters as SavedFilter[])[0].name).toBe('x'.repeat(60))
  })

  it('a duplicate name (case-insensitive, after trim) keeps only the first occurrence', () => {
    const result = normalizeSettings({
      savedFilters: [
        { name: 'Prod', matchers: [{ name: 'env', operator: '=', value: 'prod' }], isDefault: false },
        { name: ' prod ', matchers: [{ name: 'env', operator: '=', value: 'staging' }], isDefault: false },
      ],
    })
    expect(result.savedFilters).toEqual([
      { name: 'Prod', matchers: [{ name: 'env', operator: '=', value: 'prod' }], isDefault: false },
    ])
  })

  it('drops invalid matchers (bad operator, empty name, non-string value) but keeps an empty value', () => {
    const result = normalizeSettings({
      savedFilters: [
        {
          name: 'Mixed',
          matchers: [
            { name: 'severity', operator: 'nope', value: 'critical' },
            { name: '', operator: '=', value: 'x' },
            { name: 'value-not-string', operator: '=', value: 42 },
            { name: '@claimed-by', operator: '!=', value: '' },
            { name: '@age', operator: '>', value: '15m' },
          ],
          isDefault: false,
        },
      ],
    })
    expect(result.savedFilters).toEqual([
      {
        name: 'Mixed',
        matchers: [
          { name: '@claimed-by', operator: '!=', value: '' },
          { name: '@age', operator: '>', value: '15m' },
        ],
        isDefault: false,
      },
    ])
  })

  it('strips extra matcher fields (id, other) and dedupes identical matchers, first wins', () => {
    const result = normalizeSettings({
      savedFilters: [
        {
          name: 'Dup',
          matchers: [
            { id: 'x1', other: true, name: 'severity', operator: '=', value: 'critical' },
            { name: 'severity', operator: '=', value: 'critical' },
          ],
          isDefault: false,
        },
      ],
    })
    expect(result.savedFilters).toEqual([
      { name: 'Dup', matchers: [{ name: 'severity', operator: '=', value: 'critical' }], isDefault: false },
    ])
  })

  it('drops an entry with no valid matcher left', () => {
    const result = normalizeSettings({
      savedFilters: [
        { name: 'Empty', matchers: [{ name: '', operator: '=', value: 'x' }], isDefault: false },
        { name: 'Kept', matchers: [{ name: 'a', operator: '=', value: 'b' }], isDefault: false },
      ],
    })
    expect(result.savedFilters).toEqual([{ name: 'Kept', matchers: [{ name: 'a', operator: '=', value: 'b' }], isDefault: false }])
  })

  it('only the first isDefault: true survives, later ones are forced to false', () => {
    const result = normalizeSettings({
      savedFilters: [
        { name: 'A', matchers: [{ name: 'a', operator: '=', value: '1' }], isDefault: true },
        { name: 'B', matchers: [{ name: 'b', operator: '=', value: '2' }], isDefault: true },
        { name: 'C', matchers: [{ name: 'c', operator: '=', value: '3' }] },
      ],
    })
    expect(result.savedFilters).toEqual([
      { name: 'A', matchers: [{ name: 'a', operator: '=', value: '1' }], isDefault: true },
      { name: 'B', matchers: [{ name: 'b', operator: '=', value: '2' }], isDefault: false },
      { name: 'C', matchers: [{ name: 'c', operator: '=', value: '3' }], isDefault: false },
    ])
  })

  it('caps the result at MAX_SAVED_FILTERS (20)', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      name: `Filter ${i}`,
      matchers: [{ name: 'x', operator: '=' as const, value: String(i) }],
      isDefault: false,
    }))
    const result = normalizeSettings({ savedFilters: many })
    expect(result.savedFilters).toHaveLength(20)
  })

  it('a valid savedFilters config round-trips through normalizeSettings unchanged, including key order', () => {
    const config: SavedFilter[] = [
      {
        name: 'Prod critical',
        matchers: [
          { name: 'env', operator: '=', value: 'prod' },
          { name: 'severity', operator: '=', value: 'critical' },
          { name: '@age', operator: '>', value: '15m' },
          { name: '@claimed-by', operator: '!=', value: '' },
        ],
        isDefault: true,
      },
      {
        name: 'Team payments',
        matchers: [{ name: 'team', operator: '=~', value: 'payments.*' }],
        isDefault: false,
      },
    ]
    const result = normalizeSettings({ savedFilters: config })
    expect(JSON.stringify(result.savedFilters)).toBe(JSON.stringify(config))
  })
})

describe('diffFromDefaults (v1 -> v2 migration)', () => {
  it('keeps only the keys that deviate from DEFAULT_SETTINGS', () => {
    const fullV1Blob = { ...DEFAULT_SETTINGS, theme: 'light' as const }
    expect(diffFromDefaults(fullV1Blob)).toEqual({ theme: 'light' })
  })

  it('returns {} when everything matches defaults', () => {
    expect(diffFromDefaults({ ...DEFAULT_SETTINGS })).toEqual({})
  })
})

// ── Legacy defaultFilters -> savedFilters migration ─────────────────────────

describe('migrateLegacyDefaultFilters', () => {
  it('converts a legacy defaultFilters array into one default saved filter named "Default"', () => {
    const result = migrateLegacyDefaultFilters({
      theme: 'light',
      defaultFilters: [
        { name: 'severity', operator: '=', value: 'critical' },
        { name: 'env', operator: '=~', value: 'prod|staging' },
      ],
    })
    expect(result).toEqual({
      theme: 'light',
      savedFilters: [
        {
          name: MIGRATED_DEFAULT_FILTER_NAME,
          matchers: [
            { name: 'severity', operator: '=', value: 'critical' },
            { name: 'env', operator: '=~', value: 'prod|staging' },
          ],
          isDefault: true,
        },
      ],
    })
  })

  it('returns the same object reference when there is no legacy key', () => {
    const input = { theme: 'light' }
    expect(migrateLegacyDefaultFilters(input)).toBe(input)
  })

  it.each([
    [[]],
    [[{ name: 'broken', operator: 'nope', value: 'x' }]],
    ['not-an-array'],
  ])('drops the legacy key without adding savedFilters for %j', (legacy) => {
    const result = migrateLegacyDefaultFilters({ theme: 'light', defaultFilters: legacy })
    expect(result).toEqual({ theme: 'light' })
  })

  it('when both defaultFilters and savedFilters are present, savedFilters wins unchanged and the legacy key is dropped', () => {
    const existing = [{ name: 'Existing', matchers: [{ name: 'a', operator: '=', value: 'b' }], isDefault: false }]
    const result = migrateLegacyDefaultFilters({
      defaultFilters: [{ name: 'severity', operator: '=', value: 'critical' }],
      savedFilters: existing,
    })
    expect(result).toEqual({ savedFilters: existing })
  })

  it('is idempotent and the result never contains defaultFilters', () => {
    const input = { defaultFilters: [{ name: 'severity', operator: '=', value: 'critical' }] }
    const once = migrateLegacyDefaultFilters(input)
    const twice = migrateLegacyDefaultFilters(once)
    expect(twice).toEqual(once)
    expect(JSON.stringify(twice)).not.toContain('defaultFilters')
  })

  it('normalizeSettings migrates a raw defaultFilters blob into savedFilters (server read path guard)', () => {
    const result = normalizeSettings({
      defaultFilters: [{ name: 'severity', operator: '=', value: 'critical' }],
    })
    expect(result.savedFilters).toEqual([
      {
        name: MIGRATED_DEFAULT_FILTER_NAME,
        matchers: [{ name: 'severity', operator: '=', value: 'critical' }],
        isDefault: true,
      },
    ])
  })
})

describe('migratePersistedSettings', () => {
  it('migrates a v0 flat blob with legacy defaultFilters: overrides and anonOverrides get savedFilters, no defaultFilters anywhere', () => {
    // A genuine pre-savedFilters v0 blob never had a `savedFilters` field at
    // all — it predates the concept. Building it by spreading the *current*
    // DEFAULT_SETTINGS would smuggle in `savedFilters: []`, which the legacy
    // migration would then (correctly) treat as "already migrated" and skip.
    const defaultsWithoutSavedFilters: Record<string, unknown> = { ...DEFAULT_SETTINGS }
    delete defaultsWithoutSavedFilters.savedFilters
    const v0State = {
      ...defaultsWithoutSavedFilters,
      defaultFilters: [{ name: 'severity', operator: '=', value: 'critical' }],
    }
    const result = migratePersistedSettings(v0State, 0) as Record<string, unknown>
    const overrides = result.overrides as Record<string, unknown>
    const anonOverrides = result.anonOverrides as Record<string, unknown>
    expect(overrides.savedFilters).toEqual([
      {
        name: MIGRATED_DEFAULT_FILTER_NAME,
        matchers: [{ name: 'severity', operator: '=', value: 'critical' }],
        isDefault: true,
      },
    ])
    expect(anonOverrides.savedFilters).toEqual(overrides.savedFilters)
    expect(result.savedFilters).toEqual(overrides.savedFilters)
    expect(JSON.stringify(result)).not.toContain('defaultFilters')
  })

  it('migrates a v2 state with legacy defaultFilters in overrides, anonOverrides, userMirror.overrides and flat top-level', () => {
    const legacyFilters = [{ name: 'severity', operator: '=', value: 'critical' }]
    const v2State = {
      ...DEFAULT_SETTINGS,
      defaultFilters: legacyFilters,
      overrides: { defaultFilters: legacyFilters },
      anonOverrides: { defaultFilters: legacyFilters },
      globalDefaults: {},
      origin: 'server',
      syncState: 'idle',
      userMirror: { id: 'user-1', overrides: { defaultFilters: legacyFilters } },
    }
    const result = migratePersistedSettings(v2State, 2) as Record<string, unknown>
    const expectedSaved = [
      { name: MIGRATED_DEFAULT_FILTER_NAME, matchers: legacyFilters, isDefault: true },
    ]
    expect((result.overrides as Record<string, unknown>).savedFilters).toEqual(expectedSaved)
    expect((result.anonOverrides as Record<string, unknown>).savedFilters).toEqual(expectedSaved)
    const mirror = result.userMirror as { id: string; overrides: Record<string, unknown> }
    expect(mirror.id).toBe('user-1')
    expect(mirror.overrides.savedFilters).toEqual(expectedSaved)
    expect(JSON.stringify(result)).not.toContain('defaultFilters')
  })

  it('leaves a v2 state without any legacy key unchanged in substance', () => {
    const v2State = {
      ...DEFAULT_SETTINGS,
      overrides: { theme: 'light' },
      anonOverrides: { theme: 'light' },
      globalDefaults: {},
      origin: 'local',
      syncState: 'idle',
      userMirror: null,
    }
    const result = migratePersistedSettings(v2State, 2) as Record<string, unknown>
    expect(result.overrides).toEqual({ theme: 'light' })
    expect(result.theme).toBe('light')
    expect(result.userMirror).toBeNull()
  })

  it('handles null/non-object input without throwing and returns a valid empty v3 state', () => {
    const result = migratePersistedSettings(null, 0) as Record<string, unknown>
    expect(result.overrides).toEqual({})
    expect(result.anonOverrides).toEqual({})
    expect(result.userMirror).toBeNull()
    expect(JSON.stringify(result)).not.toContain('defaultFilters')
  })

  it('drops a malformed labelDisplay in a v0 blob instead of carrying it into overrides', () => {
    // A labelDisplay missing `order` (e.g. hand-edited localStorage, or a
    // pre-v2 blob nobody ever validated) must not survive the migration —
    // partitionLabelsForDisplay reads config.order.indexOf() unconditionally,
    // so an override without `order` crashes every alert render.
    const v0State = { ...DEFAULT_SETTINGS, labelDisplay: { hidden: ['test_suite'] } }
    const result = migratePersistedSettings(v0State, 0) as Record<string, unknown>
    const overrides = result.overrides as Record<string, unknown>
    expect(overrides.labelDisplay).toBeUndefined()
    expect(result.labelDisplay).toEqual(DEFAULT_SETTINGS.labelDisplay)
  })
})
