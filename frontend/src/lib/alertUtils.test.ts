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
  anchoredRegex,
  severityOrder,
  buildAckSilenceBody,
  FAST_SILENCE_DURATIONS,
  matchesLabelMatchers,
  silenceWouldMatchAlert,
  hasUnevaluableRegexMatcher,
  silenceMatchesAlert,
  getEffectiveAlertState,
  getSilenceState,
} from './alertUtils'
import type { EnrichedAlert, LabelMatcher, Silence } from '@/types'

/**
 * Scope note: `computeGroupLabelValues`, `buildGroupAckSilenceBody`,
 * `getExpiredSilence`, and `filterSilences` get their tests alongside the
 * group-silence fix (S-06 — see tmp/fable/review_silence.md), which touches
 * their behavior directly.
 */

function makeSilence(overrides: Partial<Silence> = {}): Silence {
  return {
    id: 'silence-1',
    matchers: [],
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: '2026-01-01T01:00:00Z',
    createdBy: 'alice',
    comment: 'test',
    status: { state: 'active' },
    updatedAt: '2026-01-01T00:00:00Z',
    clusterName: 'cluster-a',
    alertmanagerUrl: 'https://am.example.com',
    ...overrides,
  }
}

function lm(name: string, operator: LabelMatcher['operator'], value: string): LabelMatcher {
  return { id: name, name, operator, value }
}

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

describe('anchoredRegex', () => {
  it('anchors the pattern to the full string', () => {
    const re = anchoredRegex('web1')
    expect(re?.test('web1')).toBe(true)
    expect(re?.test('web10')).toBe(false)
    expect(re?.test('myweb1')).toBe(false)
  })

  it('supports alternation without over-matching', () => {
    const re = anchoredRegex('a|b')
    expect(re?.test('a')).toBe(true)
    expect(re?.test('b')).toBe(true)
    expect(re?.test('ab')).toBe(false)
  })

  it('matches the empty string against .*', () => {
    expect(anchoredRegex('.*')?.test('')).toBe(true)
  })

  it('returns null for a pattern that fails to compile', () => {
    expect(anchoredRegex('[')).toBeNull()
    expect(anchoredRegex('(')).toBeNull()
  })
})

describe('matchesLabelMatchers (filter-bar semantics — S-14)', () => {
  it('receiver != matches only when NONE of the alert receivers is the excluded value', () => {
    const alert = makeAlert({ receivers: [{ name: 'a' }, { name: 'b' }] })
    // Alert has receiver "a" among its receivers — "receiver != a" must NOT match,
    // even though "b" (a different receiver) is also present.
    expect(matchesLabelMatchers(alert, [lm('receiver', '!=', 'a')])).toBe(false)
    expect(matchesLabelMatchers(alert, [lm('receiver', '!=', 'c')])).toBe(true)
  })

  it('is consistent between != and !~ for receivers (both use every)', () => {
    const alert = makeAlert({ receivers: [{ name: 'a' }, { name: 'b' }] })
    expect(matchesLabelMatchers(alert, [lm('receiver', '!~', 'a')])).toBe(false)
  })

  it('stays substring/unanchored by design (filter UX, not silence semantics)', () => {
    const alert = makeAlert({ labels: { alertname: 'X', instance: 'web10' } })
    expect(matchesLabelMatchers(alert, [lm('instance', '=~', 'web1')])).toBe(true)
  })
})

describe('silenceWouldMatchAlert (Alertmanager-exact semantics — S-01/S-03)', () => {
  it('anchors regex: "web1" does not match "web10"', () => {
    const alert = makeAlert({ labels: { alertname: 'X', instance: 'web10' } })
    expect(silenceWouldMatchAlert([lm('instance', '=~', 'web1')], alert)).toBe(false)
  })

  it('anchors regex: "web1" matches "web1"', () => {
    const alert = makeAlert({ labels: { alertname: 'X', instance: 'web1' } })
    expect(silenceWouldMatchAlert([lm('instance', '=~', 'web1')], alert)).toBe(true)
  })

  it('regression: instance!~"web" DOES match "web1" (the S-01 over-silencing case)', () => {
    // This is the fatal case from the review: an unanchored implementation would
    // report "no match" here (substring "web" found in "web1"), while Alertmanager's
    // anchored ^(?:web)$ does not match "web1", so the negative matcher is true and
    // Alertmanager silences it. The preview must agree with Alertmanager, not hide this.
    const alert = makeAlert({ labels: { alertname: 'X', instance: 'web1' } })
    expect(silenceWouldMatchAlert([lm('instance', '!~', 'web')], alert)).toBe(true)
  })

  it('missing label matches the empty string (AM matcher semantics)', () => {
    const alert = makeAlert({ labels: { alertname: 'X' } })
    expect(silenceWouldMatchAlert([lm('instance', '=', '')], alert)).toBe(true)
    expect(silenceWouldMatchAlert([lm('instance', '!=', 'web1')], alert)).toBe(true)
  })

  it('ignores pseudo-labels: receiver/@receiver/@cluster never match real alert labels', () => {
    const alert = makeAlert({ labels: { alertname: 'X' }, receivers: [{ name: 'team-x' }], clusterName: 'team-x' })
    expect(silenceWouldMatchAlert([lm('receiver', '=', 'team-x')], alert)).toBe(false)
    expect(silenceWouldMatchAlert([lm('@cluster', '=', 'team-x')], alert)).toBe(false)
    // A matcher on a pseudo-label name with "!=" matches everything (label is always ""),
    // which is exactly what Alertmanager would do too — not a bug, just a consequence of
    // there being no real label with that name.
    expect(silenceWouldMatchAlert([lm('receiver', '!=', 'team-x')], alert)).toBe(true)
  })

  it('respects real labels literally named "receiver" if present', () => {
    const alert = makeAlert({ labels: { alertname: 'X', receiver: 'real-value' } })
    expect(silenceWouldMatchAlert([lm('receiver', '=', 'real-value')], alert)).toBe(true)
  })

  it('ANDs multiple matchers, including duplicate names', () => {
    const alert = makeAlert({ labels: { alertname: 'X', env: 'prod' } })
    expect(silenceWouldMatchAlert([lm('env', '=', 'prod'), lm('env', '=', 'staging')], alert)).toBe(false)
  })

  it('conservatively treats an unparseable regex as a match (safe direction)', () => {
    const alert = makeAlert({ labels: { alertname: 'X', instance: 'anything' } })
    expect(silenceWouldMatchAlert([lm('instance', '=~', '(')], alert)).toBe(true)
    expect(silenceWouldMatchAlert([lm('instance', '!~', '(')], alert)).toBe(true)
  })

  it('property: for literal (non-regex) matchers, agrees with a naive reference implementation', () => {
    const referenceMatch = (matchers: LabelMatcher[], labels: Record<string, string>): boolean =>
      matchers.every((m) => {
        const value = labels[m.name] ?? ''
        return m.operator === '=' ? value === m.value : value !== m.value
      })

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.constantFrom('alertname', 'instance', 'env', 'pod', 'missing'),
            operator: fc.constantFrom<'=' | '!='>('=', '!='),
            value: fc.string(),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        fc.dictionary(fc.constantFrom('alertname', 'instance', 'env', 'pod'), fc.string()),
        (rawMatchers, labels) => {
          const matchers: LabelMatcher[] = rawMatchers.map((m, i) => ({ id: String(i), ...m }))
          const alert = makeAlert({ labels: { alertname: 'X', ...labels } })
          expect(silenceWouldMatchAlert(matchers, alert)).toBe(referenceMatch(matchers, alert.labels))
        },
      ),
    )
  })
})

describe('hasUnevaluableRegexMatcher', () => {
  it('is false when there are no regex matchers', () => {
    expect(hasUnevaluableRegexMatcher([lm('instance', '=', 'web1')])).toBe(false)
  })

  it('is false for a compilable regex', () => {
    expect(hasUnevaluableRegexMatcher([lm('instance', '=~', 'web.*')])).toBe(false)
  })

  it('is true for an uncompilable regex (e.g. RE2-only inline flag)', () => {
    expect(hasUnevaluableRegexMatcher([lm('instance', '=~', '(?i)watchdog')])).toBe(true)
  })

  it('checks !~ matchers too', () => {
    expect(hasUnevaluableRegexMatcher([lm('instance', '!~', '(')])).toBe(true)
  })
})

describe('silenceMatchesAlert (Alertmanager-exact semantics on Silence.matchers)', () => {
  it('anchors regex matching', () => {
    const silence = makeSilence({ matchers: [{ name: 'instance', value: 'web1', isEqual: true, isRegex: true }] })
    expect(silenceMatchesAlert(silence, makeAlert({ labels: { alertname: 'X', instance: 'web1' } }))).toBe(true)
    expect(silenceMatchesAlert(silence, makeAlert({ labels: { alertname: 'X', instance: 'web10' } }))).toBe(false)
  })

  it('does not inject an @cluster pseudo-label', () => {
    const silence = makeSilence({ matchers: [{ name: '@cluster', value: 'cluster-a', isEqual: true, isRegex: false }] })
    const alert = makeAlert({ clusterName: 'cluster-a', labels: { alertname: 'X' } })
    expect(silenceMatchesAlert(silence, alert)).toBe(false)
  })

  it('exact non-regex matching', () => {
    const silence = makeSilence({ matchers: [{ name: 'env', value: 'prod', isEqual: true, isRegex: false }] })
    expect(silenceMatchesAlert(silence, makeAlert({ labels: { alertname: 'X', env: 'prod' } }))).toBe(true)
    expect(silenceMatchesAlert(silence, makeAlert({ labels: { alertname: 'X', env: 'staging' } }))).toBe(false)
  })

  it('negative regex matcher (isEqual: false) mirrors !~', () => {
    const silence = makeSilence({ matchers: [{ name: 'instance', value: 'web', isEqual: false, isRegex: true }] })
    expect(silenceMatchesAlert(silence, makeAlert({ labels: { alertname: 'X', instance: 'web1' } }))).toBe(true)
  })
})

describe('getEffectiveAlertState (multi-silence — S-05)', () => {
  it('returns the raw state when not suppressed', () => {
    const alert = makeAlert({ status: { inhibitedBy: [], silencedBy: [], state: 'active' } })
    expect(getEffectiveAlertState(alert, [])).toBe('active')
  })

  it('flips to active when the only covering silence expires within 15 minutes', () => {
    const now = Date.now()
    const silence = makeSilence({ id: 's1', endsAt: new Date(now + 5 * 60_000).toISOString() })
    const alert = makeAlert({ status: { inhibitedBy: [], silencedBy: ['s1'], state: 'suppressed' } })
    expect(getEffectiveAlertState(alert, [silence])).toBe('active')
  })

  it('regression: stays suppressed when a SECOND silence still has 3 days left, even if the first expires in 5 minutes', () => {
    const now = Date.now()
    const soon = makeSilence({ id: 's1', endsAt: new Date(now + 5 * 60_000).toISOString() })
    const long = makeSilence({ id: 's2', endsAt: new Date(now + 3 * 86_400_000).toISOString() })
    const alert = makeAlert({ status: { inhibitedBy: [], silencedBy: ['s1', 's2'], state: 'suppressed' } })
    expect(getEffectiveAlertState(alert, [soon, long])).toBe('suppressed')
    // Order must not matter — the max-remaining silence decides regardless of silencedBy order.
    const alertReversed = makeAlert({ status: { inhibitedBy: [], silencedBy: ['s2', 's1'], state: 'suppressed' } })
    expect(getEffectiveAlertState(alertReversed, [soon, long])).toBe('suppressed')
  })

  it('ignores pending and expired silences when computing remaining time', () => {
    const now = Date.now()
    const pending = makeSilence({ id: 's1', status: { state: 'pending' }, endsAt: new Date(now + 60_000).toISOString() })
    const alert = makeAlert({ status: { inhibitedBy: [], silencedBy: ['s1'], state: 'suppressed' } })
    expect(getEffectiveAlertState(alert, [pending])).toBe('suppressed')
  })

  it('stays suppressed when the covering silence id is unknown', () => {
    const alert = makeAlert({ status: { inhibitedBy: [], silencedBy: ['missing'], state: 'suppressed' } })
    expect(getEffectiveAlertState(alert, [])).toBe('suppressed')
  })
})

describe('getSilenceState (multi-silence — S-05)', () => {
  it('returns null type when there is no covering silence', () => {
    const alert = makeAlert({ status: { inhibitedBy: [], silencedBy: [], state: 'active' } })
    expect(getSilenceState(alert, []).type).toBeNull()
  })

  it('picks the active silence with the LATEST endsAt, not the first in silencedBy', () => {
    const now = Date.now()
    const soon = makeSilence({ id: 's1', endsAt: new Date(now + 5 * 60_000).toISOString() })
    const long = makeSilence({ id: 's2', endsAt: new Date(now + 3 * 86_400_000).toISOString() })
    const alert = makeAlert({ status: { inhibitedBy: [], silencedBy: ['s1', 's2'], state: 'suppressed' } })
    const result = getSilenceState(alert, [soon, long])
    expect(result.silence?.id).toBe('s2')
    expect(result.type).toBe('active')
  })

  it('reports "expiring" when the longest-remaining active silence is still within 15 minutes', () => {
    const now = Date.now()
    const silence = makeSilence({ id: 's1', endsAt: new Date(now + 5 * 60_000).toISOString() })
    const alert = makeAlert({ status: { inhibitedBy: [], silencedBy: ['s1'], state: 'suppressed' } })
    expect(getSilenceState(alert, [silence]).type).toBe('expiring')
  })

  it('falls back to pending only when no active silence covers the alert', () => {
    const pending = makeSilence({ id: 's1', status: { state: 'pending' } })
    const alert = makeAlert({ status: { inhibitedBy: [], silencedBy: ['s1'], state: 'active' } })
    expect(getSilenceState(alert, [pending]).type).toBe('pending')
  })

  it('prefers an active silence over a pending one when both cover the alert', () => {
    const now = Date.now()
    const pending = makeSilence({ id: 's1', status: { state: 'pending' } })
    const active = makeSilence({ id: 's2', status: { state: 'active' }, endsAt: new Date(now + 3 * 86_400_000).toISOString() })
    const alert = makeAlert({ status: { inhibitedBy: [], silencedBy: ['s1', 's2'], state: 'suppressed' } })
    const result = getSilenceState(alert, [pending, active])
    expect(result.type).toBe('active')
    expect(result.silence?.id).toBe('s2')
  })
})
