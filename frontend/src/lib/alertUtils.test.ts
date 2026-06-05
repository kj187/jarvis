import { describe, it, expect } from 'vitest'
import {
  getFilterableLabels,
  matchesLabelMatchers,
  getEffectiveAlertState,
  safeRegex,
} from './alertUtils'
import type { EnrichedAlert, LabelMatcher, Silence } from '@/types'

function makeAlert(labels: Record<string, string> = {}): EnrichedAlert {
  return {
    fingerprint: 'abc123',
    status: { state: 'active', inhibitedBy: [], silencedBy: [] },
    labels: { alertname: 'TestAlert', ...labels },
    annotations: {},
    startsAt: new Date().toISOString(),
    endsAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    generatorURL: '',
    receivers: [{ name: 'email' }],
    clusterName: 'homelab',
    alertmanagerUrl: 'http://am:9093',
  }
}

describe('getFilterableLabels', () => {
  it('includes @receiver and @cluster pseudo-labels', () => {
    const alert = makeAlert()
    const labels = getFilterableLabels(alert)
    expect(labels['@receiver']).toBe('email')
    expect(labels['@cluster']).toBe('homelab')
    expect(labels['receiver']).toBe('email')
  })
})

describe('matchesLabelMatchers', () => {
  it('matches = operator', () => {
    const matchers: LabelMatcher[] = [
      { id: '1', name: 'alertname', operator: '=', value: 'TestAlert' },
    ]
    expect(matchesLabelMatchers(makeAlert(), matchers)).toBe(true)
  })

  it('does not match != operator when equal', () => {
    const matchers: LabelMatcher[] = [
      { id: '1', name: 'alertname', operator: '!=', value: 'TestAlert' },
    ]
    expect(matchesLabelMatchers(makeAlert(), matchers)).toBe(false)
  })

  it('matches =~ regex', () => {
    const matchers: LabelMatcher[] = [
      { id: '1', name: 'alertname', operator: '=~', value: '^Test.*' },
    ]
    expect(matchesLabelMatchers(makeAlert(), matchers)).toBe(true)
  })

  it('does not match !~ regex when it does match', () => {
    const matchers: LabelMatcher[] = [
      { id: '1', name: 'alertname', operator: '!~', value: '^Test.*' },
    ]
    expect(matchesLabelMatchers(makeAlert(), matchers)).toBe(false)
  })

  it('returns true for empty matchers', () => {
    expect(matchesLabelMatchers(makeAlert(), [])).toBe(true)
  })

  it('handles @cluster pseudo-label', () => {
    const matchers: LabelMatcher[] = [
      { id: '1', name: '@cluster', operator: '=', value: 'homelab' },
    ]
    expect(matchesLabelMatchers(makeAlert(), matchers)).toBe(true)
  })
})

describe('safeRegex', () => {
  it('returns RegExp for valid pattern', () => {
    expect(safeRegex('^test.*')).toBeInstanceOf(RegExp)
  })

  it('returns null for invalid pattern', () => {
    expect(safeRegex('[invalid')).toBeNull()
  })
})

describe('getEffectiveAlertState', () => {
  it('returns active when not suppressed', () => {
    const alert = makeAlert()
    expect(getEffectiveAlertState(alert, [])).toBe('active')
  })

  it('returns suppressed when silence has >15 min remaining', () => {
    const alert = { ...makeAlert(), status: { state: 'suppressed' as const, inhibitedBy: [], silencedBy: ['s1'] } }
    const silence: Silence = {
      id: 's1',
      matchers: [],
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1h remaining
      createdBy: '',
      comment: '',
      status: { state: 'active' },
      updatedAt: new Date().toISOString(),
      clusterName: 'homelab',
      alertmanagerUrl: '',
    }
    expect(getEffectiveAlertState(alert, [silence])).toBe('suppressed')
  })

  it('returns active when silence expires within 15 min', () => {
    const alert = { ...makeAlert(), status: { state: 'suppressed' as const, inhibitedBy: [], silencedBy: ['s1'] } }
    const silence: Silence = {
      id: 's1',
      matchers: [],
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 min remaining
      createdBy: '',
      comment: '',
      status: { state: 'active' },
      updatedAt: new Date().toISOString(),
      clusterName: 'homelab',
      alertmanagerUrl: '',
    }
    expect(getEffectiveAlertState(alert, [silence])).toBe('active')
  })
})
