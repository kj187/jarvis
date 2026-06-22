import { describe, it, expect } from 'vitest'
import {
  getFilterableLabels,
  matchesLabelMatchers,
  getEffectiveAlertState,
  getSilenceState,
  formatSilenceDuration,
  severityOrder,
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

  it('returns suppressed when silencedBy list is empty', () => {
    const alert = { ...makeAlert(), status: { state: 'suppressed' as const, inhibitedBy: [], silencedBy: [] } }
    expect(getEffectiveAlertState(alert, [])).toBe('suppressed')
  })

  it('returns suppressed when silence not found in list', () => {
    const alert = { ...makeAlert(), status: { state: 'suppressed' as const, inhibitedBy: [], silencedBy: ['unknown-id'] } }
    expect(getEffectiveAlertState(alert, [])).toBe('suppressed')
  })
})

// ── Helper for Silence fixture ─────────────────────────────────────────────

function makeSilence(id: string, state: 'active' | 'pending' | 'expired', endsInMs = 60 * 60 * 1000): Silence {
  return {
    id,
    matchers: [],
    startsAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + endsInMs).toISOString(),
    createdBy: 'alice',
    comment: 'test',
    status: { state },
    updatedAt: new Date().toISOString(),
    clusterName: 'homelab',
    alertmanagerUrl: '',
  }
}

describe('getSilenceState', () => {
  it('returns null when alert is not silenced', () => {
    const result = getSilenceState(makeAlert(), [])
    expect(result.type).toBeNull()
    expect(result.silence).toBeNull()
  })

  it('returns active for active silence with plenty of time remaining', () => {
    const alert = { ...makeAlert(), status: { state: 'suppressed' as const, inhibitedBy: [], silencedBy: ['s1'] } }
    const silence = makeSilence('s1', 'active', 60 * 60 * 1000) // 1h
    const result = getSilenceState(alert, [silence])
    expect(result.type).toBe('active')
    expect(result.silence?.id).toBe('s1')
  })

  it('returns expiring for active silence with <15 min remaining', () => {
    const alert = { ...makeAlert(), status: { state: 'suppressed' as const, inhibitedBy: [], silencedBy: ['s1'] } }
    const silence = makeSilence('s1', 'active', 5 * 60 * 1000) // 5 min
    const result = getSilenceState(alert, [silence])
    expect(result.type).toBe('expiring')
  })

  it('returns pending for pending silence', () => {
    const alert = { ...makeAlert(), status: { state: 'suppressed' as const, inhibitedBy: [], silencedBy: ['s1'] } }
    const silence = makeSilence('s1', 'pending')
    const result = getSilenceState(alert, [silence])
    expect(result.type).toBe('pending')
  })

  it('returns null when silence ID not in list', () => {
    const alert = { ...makeAlert(), status: { state: 'suppressed' as const, inhibitedBy: [], silencedBy: ['nonexistent'] } }
    const result = getSilenceState(alert, [makeSilence('other', 'active')])
    expect(result.type).toBeNull()
  })
})

describe('formatSilenceDuration', () => {
  it('formats seconds as <1m', () => {
    expect(formatSilenceDuration(30_000)).toBe('<1m')
  })

  it('formats minutes', () => {
    expect(formatSilenceDuration(5 * 60_000)).toBe('5m')
  })

  it('formats hours exactly', () => {
    expect(formatSilenceDuration(2 * 3_600_000)).toBe('2h')
  })

  it('formats hours with remaining minutes', () => {
    expect(formatSilenceDuration(2 * 3_600_000 + 30 * 60_000)).toBe('2h 30m')
  })

  it('formats days exactly', () => {
    expect(formatSilenceDuration(3 * 24 * 3_600_000)).toBe('3d')
  })

  it('formats days with remaining hours', () => {
    expect(formatSilenceDuration(3 * 24 * 3_600_000 + 6 * 3_600_000)).toBe('3d 6h')
  })

  it('formats months', () => {
    expect(formatSilenceDuration(45 * 24 * 3_600_000)).toBe('1mo 15d')
  })

  it('formats years', () => {
    expect(formatSilenceDuration(400 * 24 * 3_600_000)).toBe('1y 1mo')
  })

  it('formats years without remaining months', () => {
    expect(formatSilenceDuration(365 * 24 * 3_600_000)).toBe('1y')
  })
})

describe('getFilterableLabels — extended', () => {
  it('handles alert with no receivers', () => {
    const alert = { ...makeAlert(), receivers: [] }
    const labels = getFilterableLabels(alert)
    expect(labels['@receiver']).toBe('')
    expect(labels['receiver']).toBe('')
  })

  it('falls back to @receiver label when receivers array is empty (DB-resolved alerts)', () => {
    const alert = { ...makeAlert({ '@receiver': 'pushover' }), receivers: [] }
    const labels = getFilterableLabels(alert)
    expect(labels['@receiver']).toBe('pushover')
    expect(labels['receiver']).toBe('pushover')
  })

  it('joins multiple receivers with comma', () => {
    const alert = {
      ...makeAlert(),
      receivers: [{ name: 'email' }, { name: 'slack' }, { name: 'pagerduty' }],
    }
    const labels = getFilterableLabels(alert)
    expect(labels['@receiver']).toBe('email,slack,pagerduty')
    expect(labels['receiver']).toBe('email,slack,pagerduty')
  })

  it('preserves original alert labels', () => {
    const alert = makeAlert({ severity: 'critical', job: 'node' })
    const labels = getFilterableLabels(alert)
    expect(labels['severity']).toBe('critical')
    expect(labels['job']).toBe('node')
  })
})

describe('severityOrder', () => {
  it('critical has lowest order number', () => {
    expect(severityOrder('critical')).toBeLessThan(severityOrder('error'))
    expect(severityOrder('error')).toBeLessThan(severityOrder('warning'))
    expect(severityOrder('warning')).toBeLessThan(severityOrder('info'))
    expect(severityOrder('info')).toBeLessThan(severityOrder('none'))
  })

  it('unknown severity gets highest order', () => {
    expect(severityOrder('unknown')).toBe(5)
  })
})

describe('matchesLabelMatchers — extended', () => {
  it('!~ operator matches when regex does not match', () => {
    const matchers: LabelMatcher[] = [
      { id: '1', name: 'alertname', operator: '!~', value: '^Other.*' },
    ]
    expect(matchesLabelMatchers(makeAlert(), matchers)).toBe(true)
  })

  it('handles missing label with = operator (empty string match)', () => {
    const matchers: LabelMatcher[] = [
      { id: '1', name: 'nonexistent', operator: '=', value: '' },
    ]
    expect(matchesLabelMatchers(makeAlert(), matchers)).toBe(true)
  })

  it('handles missing label with != operator', () => {
    const matchers: LabelMatcher[] = [
      { id: '1', name: 'nonexistent', operator: '!=', value: 'something' },
    ]
    expect(matchesLabelMatchers(makeAlert(), matchers)).toBe(true)
  })

  it('all matchers must match (AND logic)', () => {
    const matchers: LabelMatcher[] = [
      { id: '1', name: 'alertname', operator: '=', value: 'TestAlert' },
      { id: '2', name: 'alertname', operator: '=', value: 'OtherAlert' },
    ]
    expect(matchesLabelMatchers(makeAlert(), matchers)).toBe(false)
  })

  describe('multiple receivers (comma-separated)', () => {
    const multiReceiverAlert = {
      ...makeAlert(),
      receivers: [{ name: 'email' }, { name: 'slack' }, { name: 'pagerduty' }],
    }

    it('matches receiver with = operator when any receiver matches', () => {
      const matchers: LabelMatcher[] = [
        { id: '1', name: 'receiver', operator: '=', value: 'slack' },
      ]
      expect(matchesLabelMatchers(multiReceiverAlert, matchers)).toBe(true)
    })

    it('does not match receiver with = operator when no receiver matches', () => {
      const matchers: LabelMatcher[] = [
        { id: '1', name: 'receiver', operator: '=', value: 'telegram' },
      ]
      expect(matchesLabelMatchers(multiReceiverAlert, matchers)).toBe(false)
    })

    it('matches @receiver with != operator when not all receivers match', () => {
      const matchers: LabelMatcher[] = [
        { id: '1', name: '@receiver', operator: '!=', value: 'slack' },
      ]
      expect(matchesLabelMatchers(multiReceiverAlert, matchers)).toBe(true)
    })

    it('does not match @receiver with != operator when all receivers match exclusion', () => {
      const singleAlert = { ...makeAlert(), receivers: [{ name: 'slack' }] }
      const matchers: LabelMatcher[] = [
        { id: '1', name: '@receiver', operator: '!=', value: 'slack' },
      ]
      expect(matchesLabelMatchers(singleAlert, matchers)).toBe(false)
    })

    it('matches receiver with =~ regex when any receiver matches', () => {
      const matchers: LabelMatcher[] = [
        { id: '1', name: 'receiver', operator: '=~', value: '^(slack|teams)$' },
      ]
      expect(matchesLabelMatchers(multiReceiverAlert, matchers)).toBe(true)
    })

    it('does not match receiver with =~ regex when no receiver matches', () => {
      const matchers: LabelMatcher[] = [
        { id: '1', name: 'receiver', operator: '=~', value: '^telegram$' },
      ]
      expect(matchesLabelMatchers(multiReceiverAlert, matchers)).toBe(false)
    })

    it('matches receiver with !~ when not all receivers match the pattern', () => {
      const matchers: LabelMatcher[] = [
        { id: '1', name: 'receiver', operator: '!~', value: '^telegram$' },
      ]
      expect(matchesLabelMatchers(multiReceiverAlert, matchers)).toBe(true)
    })
  })
})
