import { describe, expect, it } from 'vitest'
import { alertKeySetChanged, commentCountKey } from '@/lib/commentCounts'
import type { EnrichedAlert } from '@/types'

const a = (fingerprint: string, clusterName: string) => ({ fingerprint, clusterName }) as EnrichedAlert

describe('commentCountKey', () => {
  it('matches the backend key "<cluster>::<fingerprint>"', () => {
    expect(commentCountKey('prod-eu', 'abc123')).toBe('prod-eu::abc123')
  })
})

describe('alertKeySetChanged', () => {
  it('is false for the same alerts in another order', () => {
    expect(alertKeySetChanged([a('f1', 'c1'), a('f2', 'c1')], [a('f2', 'c1'), a('f1', 'c1')])).toBe(false)
  })

  it('is true when an alert appears or disappears', () => {
    expect(alertKeySetChanged([a('f1', 'c1')], [a('f1', 'c1'), a('f2', 'c1')])).toBe(true)
    expect(alertKeySetChanged([a('f1', 'c1'), a('f2', 'c1')], [a('f1', 'c1')])).toBe(true)
  })

  it('treats the same fingerprint in another cluster as a different alert', () => {
    expect(alertKeySetChanged([a('f1', 'c1')], [a('f1', 'c2')])).toBe(true)
  })

  it('is true without a previous snapshot', () => {
    expect(alertKeySetChanged(undefined, [a('f1', 'c1')])).toBe(true)
  })
})
