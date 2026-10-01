import { describe, expect, it } from 'vitest'
import { formatBufferWindow } from './bufferWindow'

describe('formatBufferWindow', () => {
  it('formats minutes and hours readably', () => {
    expect(formatBufferWindow(60)).toBe('1 minute')
    expect(formatBufferWindow(1200)).toBe('20 minutes')
    expect(formatBufferWindow(3600)).toBe('1 hour')
    expect(formatBufferWindow(7200)).toBe('2 hours')
    expect(formatBufferWindow(5400)).toBe('90 minutes')
  })

  it('never reports less than a minute', () => {
    expect(formatBufferWindow(10)).toBe('1 minute')
  })
})
