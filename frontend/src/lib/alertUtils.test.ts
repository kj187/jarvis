import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  escapeRegexValue,
  formatAckDuration,
  formatSilenceDuration,
  formatTime,
  getFilterableLabels,
  pickIdentifierLabel,
  safeRegex,
  severityOrder,
  buildAckSilenceBody,
  FAST_SILENCE_DURATIONS,
} from './alertUtils'
import type { EnrichedAlert } from '@/types'

/**
 * Scope note: this file covers only the functions in `alertUtils.ts` that
 * the planned silence-matching rewrite (anchored regex, S-01/S-03/S-05/S-06/
 * S-14 — see tmp/fable/review_silence.md) does not touch. Matching functions
 * (`matchesLabelMatchers`, `silenceMatchesAlert`, `getEffectiveAlertState`,
 * `getSilenceState`, `getExpiredSilence`, `filterSilences`,
 * `computeGroupLabelValues`, `buildGroupAckSilenceBody`) get their tests
 * alongside that rewrite instead of locking in pre-fix behavior here.
 */

function makeAlert(overrides: Partial<EnrichedAlert> = {}): EnrichedAlert {
  return {
    fingerprint: 'abc123',
    status: { inhibitedBy: [], silencedBy: [], state: 'active' },
    labels: { alertname: 'TestAlert', severity: 'warning' },
    annotations: {},
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: '0001-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    generatorURL: '',
    receivers: [{ name: 'default' }],
    clusterName: 'cluster-a',
    alertmanagerUrl: 'https://am.example.com',
    ...overrides,
  }
}

describe('escapeRegexValue', () => {
  it('escapes every regex metacharacter', () => {
    expect(escapeRegexValue('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o')).toBe(
      'a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o',
    )
  })

  it('leaves plain alphanumerics untouched', () => {
    expect(escapeRegexValue('web1-prod')).toBe('web1-prod')
  })

  it('handles the empty string', () => {
    expect(escapeRegexValue('')).toBe('')
  })

  it('property: escaped value used as a regex matches only the original literal', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (s, other) => {
        fc.pre(s !== other)
        const re = new RegExp(`^(?:${escapeRegexValue(s)})$`)
        expect(re.test(s)).toBe(true)
        expect(re.test(other)).toBe(false)
      }),
    )
  })

  it('property: never throws when compiled as a regex', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => new RegExp(escapeRegexValue(s))).not.toThrow()
      }),
    )
  })
})

describe('safeRegex', () => {
  it('returns a working RegExp for a valid pattern', () => {
    const re = safeRegex('foo.*')
    expect(re?.test('foobar')).toBe(true)
  })

  it('returns null for an invalid pattern instead of throwing', () => {
    expect(safeRegex('[')).toBeNull()
    expect(safeRegex('(')).toBeNull()
  })
})

describe('formatSilenceDuration', () => {
  it('formats sub-minute durations as <1m', () => {
    expect(formatSilenceDuration(30_000)).toBe('<1m')
  })

  it('formats minutes', () => {
    expect(formatSilenceDuration(5 * 60_000)).toBe('5m')
  })

  it('formats hours with remainder minutes', () => {
    expect(formatSilenceDuration(90 * 60_000)).toBe('1h 30m')
  })

  it('formats exact hours without remainder', () => {
    expect(formatSilenceDuration(2 * 3_600_000)).toBe('2h')
  })

  it('formats days with remainder hours', () => {
    expect(formatSilenceDuration(26 * 3_600_000)).toBe('1d 2h')
  })

  it('formats months', () => {
    expect(formatSilenceDuration(35 * 86_400_000)).toBe('1mo 5d')
  })

  it('formats years', () => {
    expect(formatSilenceDuration(400 * 86_400_000)).toBe('1y 1mo')
  })

  it('property: never throws for any non-negative duration', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 * 365 * 86_400_000 }), (ms) => {
        expect(() => formatSilenceDuration(ms)).not.toThrow()
      }),
    )
  })
})

describe('formatAckDuration', () => {
  it('collapses exact weeks', () => {
    expect(formatAckDuration(10080)).toBe('1w')
    expect(formatAckDuration(20160)).toBe('2w')
  })

  it('collapses exact days (non-week)', () => {
    expect(formatAckDuration(1440)).toBe('1d')
  })

  it('collapses exact hours', () => {
    expect(formatAckDuration(60)).toBe('1h')
    expect(formatAckDuration(240)).toBe('4h')
  })

  it('shows plain minutes under an hour', () => {
    expect(formatAckDuration(5)).toBe('5m')
    expect(formatAckDuration(30)).toBe('30m')
  })

  it('falls back to combined hours+minutes for non-exact values', () => {
    expect(formatAckDuration(90)).toBe('1h 30m')
  })

  it('matches every FAST_SILENCE_DURATIONS label', () => {
    for (const d of FAST_SILENCE_DURATIONS) {
      expect(formatAckDuration(d.minutes)).toBe(d.label)
    }
  })
})

describe('formatTime', () => {
  it('formats absolute time with a timezone suffix', () => {
    const out = formatTime('2026-01-01T12:00:00Z', 'absolute')
    expect(out).toContain('2026')
  })

  it('formats relative time with a suffix', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    expect(formatTime(past, 'relative')).toMatch(/ago/)
  })
})

describe('severityOrder', () => {
  it('orders known severities critical < error < warning < info < none', () => {
    expect(severityOrder('critical')).toBeLessThan(severityOrder('error'))
    expect(severityOrder('error')).toBeLessThan(severityOrder('warning'))
    expect(severityOrder('warning')).toBeLessThan(severityOrder('info'))
    expect(severityOrder('info')).toBeLessThan(severityOrder('none'))
  })

  it('sorts unknown severities last', () => {
    expect(severityOrder('bogus')).toBeGreaterThan(severityOrder('none'))
  })
})

describe('getFilterableLabels', () => {
  it('adds @receiver, receiver, and @cluster pseudo-labels', () => {
    const alert = makeAlert({ receivers: [{ name: 'team-a' }, { name: 'team-b' }] })
    const labels = getFilterableLabels(alert)
    expect(labels['@receiver']).toBe('team-a,team-b')
    expect(labels['receiver']).toBe('team-a,team-b')
    expect(labels['@cluster']).toBe('cluster-a')
  })

  it('falls back to an existing @receiver label when receivers is empty', () => {
    const alert = makeAlert({ receivers: [], labels: { '@receiver': 'fallback-team' } })
    const labels = getFilterableLabels(alert)
    expect(labels['@receiver']).toBe('fallback-team')
    expect(labels['receiver']).toBe('fallback-team')
  })

  it('preserves original alert labels alongside pseudo-labels', () => {
    const alert = makeAlert({ labels: { alertname: 'X', instance: 'web1' } })
    const labels = getFilterableLabels(alert)
    expect(labels.alertname).toBe('X')
    expect(labels.instance).toBe('web1')
  })
})

describe('pickIdentifierLabel', () => {
  it('returns null for an empty alert list', () => {
    expect(pickIdentifierLabel([])).toBeNull()
  })

  it('returns null when nothing differs besides skipped labels', () => {
    const alerts = [
      makeAlert({ labels: { alertname: 'X', severity: 'warning' } }),
      makeAlert({ labels: { alertname: 'X', severity: 'critical' } }),
    ]
    expect(pickIdentifierLabel(alerts)).toBeNull()
  })

  it('picks the label with the highest distinct-value count', () => {
    const alerts = [
      makeAlert({ labels: { alertname: 'X', instance: 'a', pod: 'p1' } }),
      makeAlert({ labels: { alertname: 'X', instance: 'b', pod: 'p1' } }),
      makeAlert({ labels: { alertname: 'X', instance: 'c', pod: 'p1' } }),
    ]
    expect(pickIdentifierLabel(alerts)).toBe('instance')
  })
})

describe('buildAckSilenceBody', () => {
  it('excludes pseudo-labels and the receiver label', () => {
    const alert = makeAlert({ labels: { alertname: 'X', '@cluster': 'c', receiver: 'r', instance: 'web1' } })
    const body = buildAckSilenceBody(alert, 30, 'alice')
    const names = body.matchers.map((m) => m.name)
    expect(names).not.toContain('@cluster')
    expect(names).not.toContain('receiver')
    expect(names).toEqual(['alertname', 'instance'])
  })

  it('produces exact-match, non-regex matchers sorted by name', () => {
    const alert = makeAlert({ labels: { zeta: 'z', alertname: 'X' } })
    const body = buildAckSilenceBody(alert, 30, 'alice')
    expect(body.matchers.every((m) => m.isEqual && !m.isRegex)).toBe(true)
    expect(body.matchers.map((m) => m.name)).toEqual(['alertname', 'zeta'])
  })

  it('sets endsAt to startsAt + durationMinutes', () => {
    const alert = makeAlert()
    const body = buildAckSilenceBody(alert, 60, 'alice')
    const diffMinutes = (new Date(body.endsAt).getTime() - new Date(body.startsAt).getTime()) / 60_000
    expect(diffMinutes).toBeCloseTo(60, 5)
  })

  it('carries the fingerprint and a duration-labeled comment', () => {
    const alert = makeAlert({ fingerprint: 'deadbeef' })
    const body = buildAckSilenceBody(alert, 60, 'alice')
    expect(body.fingerprint).toBe('deadbeef')
    expect(body.comment).toBe('Fast-Silence for 1h')
  })

  it('drops labels with empty values', () => {
    const alert = makeAlert({ labels: { alertname: 'X', empty: '' } })
    const body = buildAckSilenceBody(alert, 30, 'alice')
    expect(body.matchers.map((m) => m.name)).not.toContain('empty')
  })
})
