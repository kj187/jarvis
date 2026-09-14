import { describe, expect, it } from 'vitest'
import {
  resolveSettings,
  normalizeSettings,
  diffFromDefaults,
  DEFAULT_SETTINGS,
} from './settingsUtils'

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

  it('keeps only valid defaultFilters entries', () => {
    const result = normalizeSettings({
      defaultFilters: [
        { name: 'severity', operator: '=', value: 'critical' },
        { name: 'broken', operator: 'nope', value: 'x' },
        { name: 123, operator: '=', value: 'x' },
        'not-an-object',
      ],
    })
    expect(result.defaultFilters).toEqual([{ name: 'severity', operator: '=', value: 'critical' }])
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
