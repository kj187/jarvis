import { describe, expect, it } from 'vitest'
import {
  formatDurationChoice,
  MAX_SILENCE_DURATION_CHOICES,
  MAX_SILENCE_DURATION_MINUTES,
  isValidSilenceDurationMinutes,
  normalizeSilenceDurations,
  parseSilenceDuration,
} from './silenceDurations'

describe('parseSilenceDuration', () => {
  it.each([
    ['5m', 5],
    ['90m', 90],
    ['4h', 240],
    ['1d', 1440],
    ['1w', 10080],
    ['30d', 43200],
    ['1y', 525600],
    ['365d', 525600],
  ])('parses %s to %d minutes', (text, minutes) => {
    expect(parseSilenceDuration(text)).toBe(minutes)
  })

  it('trims surrounding whitespace', () => {
    expect(parseSilenceDuration('  2h ')).toBe(120)
  })

  it.each([
    '',
    ' ',
    '30',
    'h',
    '5s',
    '1M',
    '1H',
    '-5m',
    '0m',
    '1.5h',
    '1h30m',
    '1 h',
    'forever',
    '525601m',
    '366d',
    '2y',
    '99999999999999999999d',
  ])('rejects %j', (text) => {
    expect(parseSilenceDuration(text)).toBeNull()
  })
})

describe('isValidSilenceDurationMinutes', () => {
  it.each([1, 60, 4320, MAX_SILENCE_DURATION_MINUTES])('accepts %d', (n) => {
    expect(isValidSilenceDurationMinutes(n)).toBe(true)
  })

  it.each([0, -1, 1.5, MAX_SILENCE_DURATION_MINUTES + 1, NaN, Infinity, '60', null, undefined])(
    'rejects %j',
    (v) => {
      expect(isValidSilenceDurationMinutes(v)).toBe(false)
    },
  )
})

describe('normalizeSilenceDurations', () => {
  it('sorts ascending and removes duplicates', () => {
    expect(normalizeSilenceDurations([1440, 5, 60, 5, 1440])).toEqual([5, 60, 1440])
  })

  it('drops non-integer, out-of-range and non-number entries', () => {
    expect(normalizeSilenceDurations([15, '60', 0, -5, 1.5, null, 525601, NaN, 240])).toEqual([15, 240])
  })

  it('keeps at most MAX_SILENCE_DURATION_CHOICES entries (the shortest ones)', () => {
    const raw = Array.from({ length: MAX_SILENCE_DURATION_CHOICES + 5 }, (_, i) => i + 1)
    const out = normalizeSilenceDurations(raw)
    expect(out).toHaveLength(MAX_SILENCE_DURATION_CHOICES)
    expect(out[0]).toBe(1)
    expect(out[out.length - 1]).toBe(MAX_SILENCE_DURATION_CHOICES)
  })

  it('returns [] when nothing valid is left', () => {
    expect(normalizeSilenceDurations([])).toEqual([])
    expect(normalizeSilenceDurations(['x', 0])).toEqual([])
  })
})

describe('formatDurationChoice', () => {
  it.each([
    [5, '5m'],
    [60, '1h'],
    [90, '90m'],
    [240, '4h'],
    [1440, '1d'],
    [10080, '1w'],
    [43200, '30d'],
    [86400, '60d'],
    [525600, '1y'],
  ])('%d minutes → %s', (minutes, label) => {
    expect(formatDurationChoice(minutes)).toBe(label)
  })

  it('always round-trips through parseSilenceDuration', () => {
    for (const minutes of [1, 7, 59, 61, 90, 1439, 10081, 43200, 525599, 525600]) {
      expect(parseSilenceDuration(formatDurationChoice(minutes))).toBe(minutes)
    }
  })

  it('falls back to minutes for 0', () => {
    expect(formatDurationChoice(0)).toBe('0m')
  })
})
