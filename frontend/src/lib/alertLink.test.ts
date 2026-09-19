import { describe, expect, it } from 'vitest'
import { buildAlertShareUrl } from '@/lib/alertLink'
import { parseAlertSelectionKey } from '@/lib/alertSelection'
import type { EnrichedAlert } from '@/types'

const base = { origin: 'https://jarvis.example.com', pathname: '/' }

function alertWith(state: EnrichedAlert['status']['state'], over: Partial<EnrichedAlert> = {}): EnrichedAlert {
  return { fingerprint: 'abc123def4567890', clusterName: 'prod-eu', status: { state }, ...over } as EnrichedAlert
}

function selectionOf(url: string) {
  return parseAlertSelectionKey(new URL(url).searchParams.get('alert') ?? '')
}

describe('buildAlertShareUrl', () => {
  it('points an active alert at the active view with only state and alert', () => {
    const url = new URL(buildAlertShareUrl(alertWith('active'), base))
    expect(url.origin + url.pathname).toBe('https://jarvis.example.com/')
    expect([...url.searchParams.keys()].sort()).toEqual(['alert', 'state'])
    expect(url.searchParams.get('state')).toBe('active')
  })

  it('round-trips the alert identity through the selection key', () => {
    expect(selectionOf(buildAlertShareUrl(alertWith('active'), base))).toEqual({
      fingerprint: 'abc123def4567890',
      clusterName: 'prod-eu',
    })
  })

  it('round-trips a cluster name that needs escaping', () => {
    const a = alertWith('active', { clusterName: 'eu west/1::blue' })
    expect(selectionOf(buildAlertShareUrl(a, base))).toEqual({
      fingerprint: 'abc123def4567890',
      clusterName: 'eu west/1::blue',
    })
  })

  it('uses the resolved view for a resolved alert (history is only queried there)', () => {
    expect(new URL(buildAlertShareUrl(alertWith('resolved'), base)).searchParams.get('state')).toBe('resolved')
  })

  it.each(['suppressed', 'unprocessed'] as const)('uses the active view for a %s alert', (state) => {
    expect(new URL(buildAlertShareUrl(alertWith(state), base)).searchParams.get('state')).toBe('active')
  })

  it('keeps a sub-path deployment', () => {
    const url = buildAlertShareUrl(alertWith('active'), { origin: 'https://x.io', pathname: '/jarvis/' })
    expect(url.startsWith('https://x.io/jarvis/?')).toBe(true)
  })
})
