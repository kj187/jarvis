import { describe, expect, it } from 'vitest'
import { bucketFiringStarts } from './heatmapUtils'

// Fixed reference "now": 2026-07-08 14:23:00 local time.
const NOW = new Date(2026, 6, 8, 14, 23, 0)

describe('bucketFiringStarts — 24h', () => {
  it('returns 24 hourly cells, oldest to newest', () => {
    const cells = bucketFiringStarts([], '24h', NOW)
    expect(cells).toHaveLength(24)
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i].start.getTime()).toBe(cells[i - 1].end.getTime())
    }
  })

  it('the last cell covers the current hour', () => {
    const cells = bucketFiringStarts([], '24h', NOW)
    const last = cells[cells.length - 1]
    expect(last.start.getHours()).toBe(14)
    expect(last.start.getMinutes()).toBe(0)
    expect(last.end.getTime() - last.start.getTime()).toBe(3_600_000)
  })

  it('counts a firing timestamp in the correct hourly cell', () => {
    const firedAt = new Date(2026, 6, 8, 10, 45, 0) // 10:45 → 10:00 bucket
    const cells = bucketFiringStarts([firedAt.toISOString()], '24h', NOW)
    const totalCount = cells.reduce((sum, c) => sum + c.count, 0)
    expect(totalCount).toBe(1)
    const matching = cells.find((c) => c.start.getHours() === 10 && c.start.getDate() === 8)
    expect(matching?.count).toBe(1)
  })

  it('drops timestamps older than the 24h window', () => {
    const tooOld = new Date(NOW.getTime() - 25 * 3_600_000)
    const cells = bucketFiringStarts([tooOld.toISOString()], '24h', NOW)
    const totalCount = cells.reduce((sum, c) => sum + c.count, 0)
    expect(totalCount).toBe(0)
  })

  it('empty input → all-zero cells, no error', () => {
    const cells = bucketFiringStarts([], '24h', NOW)
    expect(cells.every((c) => c.count === 0)).toBe(true)
  })

  it('multiple firings in the same hour accumulate', () => {
    const a = new Date(2026, 6, 8, 9, 5, 0)
    const b = new Date(2026, 6, 8, 9, 50, 0)
    const cells = bucketFiringStarts([a.toISOString(), b.toISOString()], '24h', NOW)
    const matching = cells.find((c) => c.start.getHours() === 9 && c.start.getDate() === 8)
    expect(matching?.count).toBe(2)
  })
})

describe('bucketFiringStarts — 7d', () => {
  it('returns 168 hourly cells (7 × 24), oldest to newest', () => {
    const cells = bucketFiringStarts([], '7d', NOW)
    expect(cells).toHaveLength(168)
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i].start.getTime()).toBe(cells[i - 1].end.getTime())
    }
  })

  it('total firing count is preserved across the window', () => {
    const timestamps = Array.from({ length: 20 }, (_, i) =>
      new Date(NOW.getTime() - i * 8 * 3_600_000).toISOString(),
    )
    const cells = bucketFiringStarts(timestamps, '7d', NOW)
    const totalCount = cells.reduce((sum, c) => sum + c.count, 0)
    expect(totalCount).toBe(20)
  })

  it('drops timestamps older than the 7d window', () => {
    const tooOld = new Date(NOW.getTime() - 8 * 24 * 3_600_000)
    const cells = bucketFiringStarts([tooOld.toISOString()], '7d', NOW)
    const totalCount = cells.reduce((sum, c) => sum + c.count, 0)
    expect(totalCount).toBe(0)
  })
})

describe('bucketFiringStarts — 30d', () => {
  it('returns 30 daily cells aligned to local midnight, oldest to newest', () => {
    const cells = bucketFiringStarts([], '30d', NOW)
    expect(cells).toHaveLength(30)
    for (const c of cells) {
      expect(c.start.getHours()).toBe(0)
      expect(c.start.getMinutes()).toBe(0)
    }
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i].start.getTime()).toBe(cells[i - 1].end.getTime())
    }
  })

  it('the last cell is today', () => {
    const cells = bucketFiringStarts([], '30d', NOW)
    const last = cells[cells.length - 1]
    expect(last.start.getDate()).toBe(8)
    expect(last.start.getMonth()).toBe(6)
  })

  it('counts a firing timestamp in the correct daily cell', () => {
    const firedAt = new Date(2026, 6, 3, 22, 0, 0)
    const cells = bucketFiringStarts([firedAt.toISOString()], '30d', NOW)
    const matching = cells.find((c) => c.start.getDate() === 3 && c.start.getMonth() === 6)
    expect(matching?.count).toBe(1)
  })

  it('drops timestamps older than the 30d window', () => {
    const tooOld = new Date(2026, 5, 1) // more than 30 days before NOW
    const cells = bucketFiringStarts([tooOld.toISOString()], '30d', NOW)
    const totalCount = cells.reduce((sum, c) => sum + c.count, 0)
    expect(totalCount).toBe(0)
  })

  it('DST transition week: total count is preserved', () => {
    // Any real-world DST spring-forward/fall-back day only shifts wall-clock
    // labels, never drops or double-counts a firing timestamp.
    const dstNow = new Date(2026, 2, 30, 10, 0, 0) // late March — near a EU DST transition
    const timestamps = Array.from({ length: 10 }, (_, i) =>
      new Date(dstNow.getTime() - i * 2 * 24 * 3_600_000).toISOString(),
    )
    const cells = bucketFiringStarts(timestamps, '30d', dstNow)
    const totalCount = cells.reduce((sum, c) => sum + c.count, 0)
    expect(totalCount).toBe(10)
  })
})
