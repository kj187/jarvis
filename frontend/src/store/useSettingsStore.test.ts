import { describe, it, expect, beforeEach } from 'vitest'
import {
  useSettingsStore,
  DEFAULT_SETTINGS,
  nearestPollOption,
  POLL_OPTIONS,
} from './useSettingsStore'

beforeEach(() => {
  useSettingsStore.setState({ ...DEFAULT_SETTINGS })
})

describe('defaults', () => {
  it('has correct default values', () => {
    const s = useSettingsStore.getState()
    expect(s.timeFormat).toBe('relative')
    expect(s.defaultViewMode).toBe('card')
    expect(s.defaultFilters).toEqual([])
    expect(s.resolvedPageSize).toBe(25)
    expect(s.defaultSilenceDurationMinutes).toBe(60)
    expect(s.defaultCreatorName).toBe('')
    expect(s.pollIntervalSeconds).toBe(15)
  })
})

describe('update', () => {
  it('updates a single setting', () => {
    useSettingsStore.getState().update({ timeFormat: 'absolute' })
    expect(useSettingsStore.getState().timeFormat).toBe('absolute')
  })

  it('does not overwrite unrelated settings', () => {
    useSettingsStore.getState().update({ defaultSilenceDurationMinutes: 30 })
    expect(useSettingsStore.getState().timeFormat).toBe('relative')
    expect(useSettingsStore.getState().pollIntervalSeconds).toBe(15)
  })

  it('updates defaultFilters', () => {
    useSettingsStore.getState().update({
      defaultFilters: [{ name: 'severity', operator: '=', value: 'critical' }],
    })
    expect(useSettingsStore.getState().defaultFilters).toHaveLength(1)
    expect(useSettingsStore.getState().defaultFilters[0].name).toBe('severity')
  })

  it('updates pollIntervalSeconds', () => {
    useSettingsStore.getState().update({ pollIntervalSeconds: 30 })
    expect(useSettingsStore.getState().pollIntervalSeconds).toBe(30)
  })
})

describe('reset', () => {
  it('restores all defaults', () => {
    useSettingsStore.getState().update({
      timeFormat: 'absolute',
      pollIntervalSeconds: 60,
      defaultFilters: [{ name: 'job', operator: '=', value: 'node' }],
    })
    useSettingsStore.getState().reset()
    const s = useSettingsStore.getState()
    expect(s.timeFormat).toBe('relative')
    expect(s.pollIntervalSeconds).toBe(15)
    expect(s.defaultFilters).toEqual([])
  })
})

describe('nearestPollOption', () => {
  it('returns exact match', () => {
    for (const opt of POLL_OPTIONS) {
      expect(nearestPollOption(opt)).toBe(opt)
    }
  })

  it('rounds to nearest option', () => {
    expect(nearestPollOption(7)).toBe(5)
    expect(nearestPollOption(8)).toBe(10)
    expect(nearestPollOption(12)).toBe(10)
    expect(nearestPollOption(13)).toBe(15)
  })

  it('maps arbitrary values to known options', () => {
    expect(nearestPollOption(0)).toBe(5)
    expect(nearestPollOption(999)).toBe(60)
  })
})
