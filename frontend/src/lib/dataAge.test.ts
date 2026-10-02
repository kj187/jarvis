import { describe, expect, it } from 'vitest'
import { formatDataAge } from './dataAge'

const now = new Date('2026-10-02T10:00:00Z').getTime()

describe('formatDataAge', () => {
  it('formats minutes, hours and days', () => {
    expect(formatDataAge('2026-10-02T09:59:30Z', now)).toBe('just now')
    expect(formatDataAge('2026-10-02T09:50:00Z', now)).toBe('10 min ago')
    expect(formatDataAge('2026-10-02T07:00:00Z', now)).toBe('3 h ago')
    expect(formatDataAge('2026-09-29T10:00:00Z', now)).toBe('3 d ago')
  })

  it('says so when no fetch has succeeded yet', () => {
    expect(formatDataAge(undefined, now)).toBe('no data yet')
  })

  it('never reports a negative age for clock skew', () => {
    expect(formatDataAge('2026-10-02T10:05:00Z', now)).toBe('just now')
  })
})
