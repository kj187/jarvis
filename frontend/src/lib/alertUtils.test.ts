import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  escapeRegexValue,
  formatAckDuration,
  formatSilenceDuration,
  formatTime,
  computeLabelBreakdown,
  getFilterableLabels,
  pickIdentifierLabel,
  safeRegex,
  anchoredRegex,
  severityOrder,
  buildAckSilenceBody,
  FAST_SILENCE_DURATIONS,
  matchesLabelMatchers,
  parseDurationValue,
  silenceWouldMatchAlert,
  hasUnevaluableRegexMatcher,
  silenceMatchesAlert,
  getEffectiveAlertState,
  getSilenceState,
  computeGroupLabelValues,
  buildGroupAckSilenceBody,
  filterSilences,
  getExpiredSilence,
  labelColorStyle,
  unescapeRegex,
  isRoundTrippableTagList,
  findRelatedAlerts,
} from './alertUtils'
import type { EnrichedAlert, LabelMatcher, Silence } from '@/types'

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

describe('unescapeRegex', () => {
  it('strips a backslash before any character, not just regex metacharacters', () => {
    expect(unescapeRegex('web\\-prod')).toBe('web-prod')
    expect(unescapeRegex('a\\/b')).toBe('a/b')
    expect(unescapeRegex('a\\zb')).toBe('azb')
  })

  it('leaves a string with no backslashes untouched', () => {
    expect(unescapeRegex('web1-prod')).toBe('web1-prod')
  })

  it('is the left inverse of escapeRegexValue for any string', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(unescapeRegex(escapeRegexValue(s))).toBe(s)
      }),
    )
  })
})

describe('isRoundTrippableTagList (S-09)', () => {
  it('is true for a value SilenceForm itself would produce from literal tags', () => {
    expect(isRoundTrippableTagList('web1')).toBe(true)
    expect(isRoundTrippableTagList('web1|web2')).toBe(true)
    expect(isRoundTrippableTagList(escapeRegexValue('10.0.0.1'))).toBe(true)
  })

  it('is false for a real regex with alternation groups (S-09 core case)', () => {
    // web-(1|2)\.example\.com split on "|" gives "web-(1" / "2)\.example\.com" — re-escaping
    // and rejoining produces a different string, so this must be flagged as non-round-trippable
    // rather than silently edited (and corrupted) as a two-item literal tag list.
    expect(isRoundTrippableTagList('web-(1|2)\\.example\\.com')).toBe(false)
  })

  it('is false for a power-user-typed regex like a character class or quantifier', () => {
    expect(isRoundTrippableTagList('web-\\d+')).toBe(false)
    expect(isRoundTrippableTagList('[a-z]+')).toBe(false)
  })

  it('is true for the empty string', () => {
    expect(isRoundTrippableTagList('')).toBe(true)
  })

  it('property: always true for escapeRegexValue applied to arbitrary literal tags', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }).filter((s) => !s.includes('|')), { minLength: 1, maxLength: 5 }),
        (tags) => {
          const amValue = tags.map(escapeRegexValue).join('|')
          expect(isRoundTrippableTagList(amValue)).toBe(true)
        },
      ),
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

  it('formats exact days without remainder', () => {
    expect(formatSilenceDuration(24 * 3_600_000)).toBe('1d')
  })

  it('formats months', () => {
    expect(formatSilenceDuration(35 * 86_400_000)).toBe('1mo 5d')
  })

  it('formats exact months without remainder', () => {
    expect(formatSilenceDuration(30 * 86_400_000)).toBe('1mo')
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

  it('falls back to an empty string when receivers is empty and no @receiver label exists', () => {
    const alert = makeAlert({ receivers: [], labels: { alertname: 'X' } })
    const labels = getFilterableLabels(alert)
    expect(labels['@receiver']).toBe('')
    expect(labels['receiver']).toBe('')
  })

  it('preserves original alert labels alongside pseudo-labels', () => {
    const alert = makeAlert({ labels: { alertname: 'X', instance: 'web1' } })
    const labels = getFilterableLabels(alert)
    expect(labels.alertname).toBe('X')
    expect(labels.instance).toBe('web1')
  })

  it('sets @claimed-by to the active claim\'s claimedBy', () => {
    const alert = makeAlert({
      activeClaim: { id: 1, fingerprint: 'abc123', clusterName: 'cluster-a', claimedBy: 'julian', claimedAt: '2026-01-01T00:00:00Z' },
    })
    const labels = getFilterableLabels(alert)
    expect(labels['@claimed-by']).toBe('julian')
  })

  it('sets @claimed-by to the empty string when unclaimed', () => {
    const alert = makeAlert()
    const labels = getFilterableLabels(alert)
    expect(labels['@claimed-by']).toBe('')
  })
})

describe('parseDurationValue', () => {
  it('parses seconds, minutes, hours, days', () => {
    expect(parseDurationValue('30s')).toBe(30_000)
    expect(parseDurationValue('15m')).toBe(15 * 60_000)
    expect(parseDurationValue('2h')).toBe(2 * 60 * 60_000)
    expect(parseDurationValue('1d')).toBe(24 * 60 * 60_000)
  })

  it('trims whitespace', () => {
    expect(parseDurationValue('  15m  ')).toBe(15 * 60_000)
  })

  it('accepts 0 as a valid value', () => {
    expect(parseDurationValue('0m')).toBe(0)
  })

  it('returns null for invalid input', () => {
    expect(parseDurationValue('')).toBeNull()
    expect(parseDurationValue('15')).toBeNull()
    expect(parseDurationValue('m')).toBeNull()
    expect(parseDurationValue('15x')).toBeNull()
    expect(parseDurationValue('1.5h')).toBeNull()
    expect(parseDurationValue('15m ago')).toBeNull()
    expect(parseDurationValue('-5m')).toBeNull()
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

  it('treats a label missing on some alerts as the empty string when counting distinct values', () => {
    const alerts = [
      makeAlert({ labels: { alertname: 'X', pod: 'p1' } }),
      makeAlert({ labels: { alertname: 'X' } }), // no `pod` label at all
    ]
    expect(pickIdentifierLabel(alerts)).toBe('pod')
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

  it('receiver = matches if ANY of the alert receivers equals the value', () => {
    const alert = makeAlert({ receivers: [{ name: 'a' }, { name: 'b' }] })
    expect(matchesLabelMatchers(alert, [lm('receiver', '=', 'a')])).toBe(true)
    expect(matchesLabelMatchers(alert, [lm('receiver', '=', 'c')])).toBe(false)
  })

  it('receiver =~ matches if ANY of the alert receivers matches the pattern', () => {
    const alert = makeAlert({ receivers: [{ name: 'team-a' }, { name: 'team-b' }] })
    expect(matchesLabelMatchers(alert, [lm('receiver', '=~', 'team-a')])).toBe(true)
    expect(matchesLabelMatchers(alert, [lm('receiver', '=~', 'team-c')])).toBe(false)
  })

  it('receiver =~/!~ with an unparseable pattern: no match / matches everything', () => {
    const alert = makeAlert({ receivers: [{ name: 'a' }, { name: 'b' }] })
    expect(matchesLabelMatchers(alert, [lm('receiver', '=~', '(')])).toBe(false)
    expect(matchesLabelMatchers(alert, [lm('receiver', '!~', '(')])).toBe(true)
  })

  it('stays substring/unanchored by design (filter UX, not silence semantics)', () => {
    const alert = makeAlert({ labels: { alertname: 'X', instance: 'web10' } })
    expect(matchesLabelMatchers(alert, [lm('instance', '=~', 'web1')])).toBe(true)
  })

  it('standard (non-receiver) label: = operator', () => {
    const alert = makeAlert({ labels: { alertname: 'X', env: 'prod' } })
    expect(matchesLabelMatchers(alert, [lm('env', '=', 'prod')])).toBe(true)
    expect(matchesLabelMatchers(alert, [lm('env', '=', 'staging')])).toBe(false)
  })

  it('standard (non-receiver) label: != and !~ operators', () => {
    const alert = makeAlert({ labels: { alertname: 'X', env: 'prod' } })
    expect(matchesLabelMatchers(alert, [lm('env', '!=', 'prod')])).toBe(false)
    expect(matchesLabelMatchers(alert, [lm('env', '!=', 'staging')])).toBe(true)
    expect(matchesLabelMatchers(alert, [lm('env', '!~', 'prod')])).toBe(false)
    expect(matchesLabelMatchers(alert, [lm('env', '!~', 'staging')])).toBe(true)
  })

  it('empty matcher list matches everything', () => {
    expect(matchesLabelMatchers(makeAlert(), [])).toBe(true)
  })

  it('missing label is treated as the empty string', () => {
    const alert = makeAlert({ labels: { alertname: 'X' } })
    expect(matchesLabelMatchers(alert, [lm('instance', '=', '')])).toBe(true)
    expect(matchesLabelMatchers(alert, [lm('instance', '=', 'web1')])).toBe(false)
  })

  it('standard (non-receiver) label =~/!~ with an unparseable pattern: no match / matches everything', () => {
    const alert = makeAlert({ labels: { alertname: 'X', env: 'prod' } })
    expect(matchesLabelMatchers(alert, [lm('env', '=~', '(')])).toBe(false)
    expect(matchesLabelMatchers(alert, [lm('env', '!~', '(')])).toBe(true)
  })

  it('@age >: matches when the alert is older than the duration', () => {
    const alert = makeAlert({ startsAt: new Date(Date.now() - 20 * 60_000).toISOString() })
    expect(matchesLabelMatchers(alert, [lm('@age', '>', '15m')])).toBe(true)
    expect(matchesLabelMatchers(alert, [lm('@age', '>', '25m')])).toBe(false)
  })

  it('@age <: matches when the alert is younger than the duration', () => {
    const alert = makeAlert({ startsAt: new Date(Date.now() - 10 * 60_000).toISOString() })
    expect(matchesLabelMatchers(alert, [lm('@age', '<', '15m')])).toBe(true)
    expect(matchesLabelMatchers(alert, [lm('@age', '<', '5m')])).toBe(false)
  })

  it('@age with an invalid duration value matches nothing', () => {
    const alert = makeAlert({ startsAt: new Date(Date.now() - 20 * 60_000).toISOString() })
    expect(matchesLabelMatchers(alert, [lm('@age', '>', 'bogus')])).toBe(false)
    expect(matchesLabelMatchers(alert, [lm('@age', '<', 'bogus')])).toBe(false)
  })

  it('@age with an unsupported operator matches nothing', () => {
    const alert = makeAlert({ startsAt: new Date(Date.now() - 20 * 60_000).toISOString() })
    expect(matchesLabelMatchers(alert, [lm('@age', '=', '15m')])).toBe(false)
    expect(matchesLabelMatchers(alert, [lm('@age', '!=', '15m')])).toBe(false)
    expect(matchesLabelMatchers(alert, [lm('@age', '=~', '15m')])).toBe(false)
    expect(matchesLabelMatchers(alert, [lm('@age', '!~', '15m')])).toBe(false)
  })

  it('> and < on a normal (non-@age) label never match', () => {
    const alert = makeAlert({ labels: { alertname: 'X', env: 'prod' } })
    expect(matchesLabelMatchers(alert, [lm('env', '>', 'prod')])).toBe(false)
    expect(matchesLabelMatchers(alert, [lm('env', '<', 'prod')])).toBe(false)
  })

  it('@claimed-by = / != match against the active claim', () => {
    const claimed = makeAlert({
      activeClaim: { id: 1, fingerprint: 'abc123', clusterName: 'cluster-a', claimedBy: 'julian', claimedAt: '2026-01-01T00:00:00Z' },
    })
    const unclaimed = makeAlert()
    expect(matchesLabelMatchers(claimed, [lm('@claimed-by', '=', 'julian')])).toBe(true)
    expect(matchesLabelMatchers(unclaimed, [lm('@claimed-by', '=', 'julian')])).toBe(false)
    expect(matchesLabelMatchers(unclaimed, [lm('@claimed-by', '!=', '')])).toBe(false)
    expect(matchesLabelMatchers(claimed, [lm('@claimed-by', '!=', '')])).toBe(true)
  })

  it('@claimed-by =~ matches by pattern', () => {
    const claimed = makeAlert({
      activeClaim: { id: 1, fingerprint: 'abc123', clusterName: 'cluster-a', claimedBy: 'julian', claimedAt: '2026-01-01T00:00:00Z' },
    })
    expect(matchesLabelMatchers(claimed, [lm('@claimed-by', '=~', 'jul.*')])).toBe(true)
    expect(matchesLabelMatchers(claimed, [lm('@claimed-by', '=~', 'mike')])).toBe(false)
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

  it('exact non-regex negative matcher (isEqual: false)', () => {
    const silence = makeSilence({ matchers: [{ name: 'env', value: 'prod', isEqual: false, isRegex: false }] })
    expect(silenceMatchesAlert(silence, makeAlert({ labels: { alertname: 'X', env: 'prod' } }))).toBe(false)
    expect(silenceMatchesAlert(silence, makeAlert({ labels: { alertname: 'X', env: 'staging' } }))).toBe(true)
  })

  it('conservatively treats an unparseable regex as a match', () => {
    const silence = makeSilence({ matchers: [{ name: 'instance', value: '(', isEqual: true, isRegex: true }] })
    expect(silenceMatchesAlert(silence, makeAlert({ labels: { alertname: 'X', instance: 'anything' } }))).toBe(true)
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

    // Order must not matter — reversed silencedBy should pick the same (longest) silence.
    const alertReversed = makeAlert({ status: { inhibitedBy: [], silencedBy: ['s2', 's1'], state: 'suppressed' } })
    expect(getSilenceState(alertReversed, [soon, long]).silence?.id).toBe('s2')
  })

  it('ignores an unknown silence id in silencedBy', () => {
    const alert = makeAlert({ status: { inhibitedBy: [], silencedBy: ['missing'], state: 'suppressed' } })
    expect(getSilenceState(alert, []).type).toBeNull()
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

describe('computeGroupLabelValues (S-06)', () => {
  it('returns an empty array for an empty group', () => {
    expect(computeGroupLabelValues([])).toEqual([])
  })

  it('exact-matches a label with the same value on every alert', () => {
    const alerts = [
      makeAlert({ labels: { alertname: 'X', env: 'prod' } }),
      makeAlert({ labels: { alertname: 'X', env: 'prod' } }),
    ]
    const result = computeGroupLabelValues(alerts)
    expect(result).toContainEqual({ name: 'env', values: ['prod'] })
  })

  it('OR-matches a label whose value varies, as long as EVERY alert has it', () => {
    const alerts = [
      makeAlert({ labels: { alertname: 'X', pod: 'p1' } }),
      makeAlert({ labels: { alertname: 'X', pod: 'p2' } }),
    ]
    const result = computeGroupLabelValues(alerts)
    const pod = result.find((r) => r.name === 'pod')
    expect(pod?.values.sort()).toEqual(['p1', 'p2'])
  })

  it('regression (S-06): drops a label present on only SOME alerts instead of a partial OR-match', () => {
    // Before the fix, this produced a `pod=~"p1"` matcher: it would silence the
    // first alert but NOT the second, which has no `pod` label at all (a missing
    // label matches the empty string in Alertmanager, not "p1") — a group
    // Fast-Silence that silently failed to cover part of the selected group.
    const alerts = [
      makeAlert({ fingerprint: 'a', labels: { alertname: 'X', pod: 'p1' } }),
      makeAlert({ fingerprint: 'b', labels: { alertname: 'X' } }),
    ]
    const result = computeGroupLabelValues(alerts)
    expect(result.find((r) => r.name === 'pod')).toBeUndefined()
    // alertname is on both, so it's still included.
    expect(result).toContainEqual({ name: 'alertname', values: ['X'] })
  })

  it('excludes receiver/@receiver/@cluster even if literally present as raw labels', () => {
    // These normally only exist as synthesized pseudo-labels (see getFilterableLabels), but
    // computeGroupLabelValues reads alert.labels directly — this guards the skip-set itself.
    const alerts = [makeAlert({ labels: { alertname: 'X', receiver: 'r', '@receiver': 'r', '@cluster': 'c' } })]
    const names = computeGroupLabelValues(alerts).map((r) => r.name)
    expect(names).not.toContain('receiver')
    expect(names).not.toContain('@receiver')
    expect(names).not.toContain('@cluster')
    expect(names).toContain('alertname')
  })

  it('property: every returned label is present with a non-empty value on every input alert', () => {
    fc.assert(
      fc.property(
        fc.array(fc.dictionary(fc.constantFrom('alertname', 'pod', 'env', 'instance'), fc.string({ minLength: 1 })), {
          minLength: 1,
          maxLength: 6,
        }),
        (labelSets) => {
          const alerts = labelSets.map((labels, i) => makeAlert({ fingerprint: String(i), labels: { alertname: 'X', ...labels } }))
          const result = computeGroupLabelValues(alerts)
          for (const { name } of result) {
            expect(alerts.every((a) => Boolean(a.labels[name]))).toBe(true)
          }
        },
      ),
    )
  })
})

describe('buildGroupAckSilenceBody (S-06)', () => {
  it('produces matchers that would match every alert in the group (anchored, real semantics)', () => {
    const alerts = [
      makeAlert({ fingerprint: 'a', labels: { alertname: 'X', pod: 'p1' } }),
      makeAlert({ fingerprint: 'b', labels: { alertname: 'X', pod: 'p2' } }),
    ]
    const body = buildGroupAckSilenceBody(alerts, 30, 'alice')
    const lm: LabelMatcher[] = body.matchers.map((m, i) => ({
      id: String(i),
      name: m.name,
      operator: (m.isRegex ? (m.isEqual ? '=~' : '!~') : m.isEqual ? '=' : '!=') as LabelMatcher['operator'],
      value: m.value,
    }))
    for (const alert of alerts) {
      expect(silenceWouldMatchAlert(lm, alert)).toBe(true)
    }
  })

  it('regression (S-06): covers an alert lacking a label that varies on the rest of the group', () => {
    const alerts = [
      makeAlert({ fingerprint: 'a', labels: { alertname: 'X', pod: 'p1' } }),
      makeAlert({ fingerprint: 'b', labels: { alertname: 'X' } }), // no `pod` label at all
    ]
    const body = buildGroupAckSilenceBody(alerts, 30, 'alice')
    const lm: LabelMatcher[] = body.matchers.map((m, i) => ({
      id: String(i),
      name: m.name,
      operator: (m.isRegex ? (m.isEqual ? '=~' : '!~') : m.isEqual ? '=' : '!=') as LabelMatcher['operator'],
      value: m.value,
    }))
    for (const alert of alerts) {
      expect(silenceWouldMatchAlert(lm, alert)).toBe(true)
    }
  })

  it('throws when alerts span more than one cluster', () => {
    const alerts = [
      makeAlert({ fingerprint: 'a', clusterName: 'cluster-a' }),
      makeAlert({ fingerprint: 'b', clusterName: 'cluster-b' }),
    ]
    expect(() => buildGroupAckSilenceBody(alerts, 30, 'alice')).toThrow(/multiple clusters/)
  })

  it('carries duration, comment, and creator through', () => {
    const alerts = [makeAlert({ labels: { alertname: 'X' } })]
    const body = buildGroupAckSilenceBody(alerts, 60, 'alice')
    expect(body.createdBy).toBe('alice')
    expect(body.comment).toBe('Fast-Silence for 1h')
    const diffMinutes = (new Date(body.endsAt).getTime() - new Date(body.startsAt).getTime()) / 60_000
    expect(diffMinutes).toBeCloseTo(60, 5)
  })
})

describe('labelColorStyle', () => {
  it('is deterministic for the same key and theme', () => {
    expect(labelColorStyle('instance', 'dark')).toEqual(labelColorStyle('instance', 'dark'))
  })

  it('differs between light and dark theme', () => {
    expect(labelColorStyle('instance', 'light')).not.toEqual(labelColorStyle('instance', 'dark'))
  })

  it('defaults to dark theme', () => {
    expect(labelColorStyle('instance')).toEqual(labelColorStyle('instance', 'dark'))
  })
})

describe('filterSilences', () => {
  const silences: Silence[] = [
    makeSilence({ id: 's1', comment: 'planned maintenance', createdBy: 'alice', clusterName: 'cluster-a', matchers: [{ name: 'env', value: 'prod', isEqual: true, isRegex: false }] }),
    makeSilence({ id: 's2', comment: 'noisy alert', createdBy: 'bob', clusterName: 'cluster-b', matchers: [{ name: 'instance', value: 'web1', isEqual: true, isRegex: false }] }),
  ]

  it('returns all silences when search and matchers are empty', () => {
    expect(filterSilences(silences, '', [])).toEqual(silences)
  })

  it('filters by comment substring (case-insensitive)', () => {
    expect(filterSilences(silences, 'PLANNED', []).map((s) => s.id)).toEqual(['s1'])
  })

  it('filters by createdBy substring', () => {
    expect(filterSilences(silences, 'bob', []).map((s) => s.id)).toEqual(['s2'])
  })

  it('filters by matcher name or value substring', () => {
    expect(filterSilences(silences, 'web1', []).map((s) => s.id)).toEqual(['s2'])
  })

  it.each([
    ['=', 'cluster-a', ['s1']],
    ['!=', 'cluster-a', ['s2']],
    ['=~', 'cluster-.', ['s1', 's2']],
    ['!~', 'cluster-a', ['s2']],
  ] as const)('filters by @cluster pseudo-label with operator %s', (operator, value, wantIds) => {
    const fm: LabelMatcher = { id: '1', name: '@cluster', operator, value }
    expect(filterSilences(silences, '', [fm]).map((s) => s.id)).toEqual(wantIds)
  })

  it('treats an unparseable regex pattern on @cluster as no match (=~) / any match (!~)', () => {
    expect(filterSilences(silences, '', [{ id: '1', name: '@cluster', operator: '=~', value: '(' }])).toEqual([])
    expect(filterSilences(silences, '', [{ id: '1', name: '@cluster', operator: '!~', value: '(' }])).toEqual(silences)
  })

  it.each([
    ['=', 'prod', ['s1']],
    // Note: "!=" and "!~" require an actual matcher of that name on the silence to compare
    // against — a silence with no "env" matcher at all doesn't satisfy either (it's a `some()`
    // over the silence's own matchers, not "no env label means anything != is trivially true").
    ['!=', 'prod', []],
    ['=~', 'pro.', ['s1']],
    ['!~', 'prod', []],
  ] as const)('filters by a real matcher label on the silence with operator %s', (operator, value, wantIds) => {
    const fm: LabelMatcher = { id: '1', name: 'env', operator, value }
    expect(filterSilences(silences, '', [fm]).map((s) => s.id)).toEqual(wantIds)
  })

  it('treats an unparseable regex pattern on a real matcher label as no match (=~) / any match (!~)', () => {
    expect(filterSilences(silences, '', [{ id: '1', name: 'env', operator: '=~', value: '(' }])).toEqual([])
    expect(filterSilences(silences, '', [{ id: '1', name: 'env', operator: '!~', value: '(' }]).map((s) => s.id)).toEqual(['s1'])
  })

  it('treats receiver/@receiver label filters as a no-op (silences have no receiver)', () => {
    const fm: LabelMatcher = { id: '1', name: 'receiver', operator: '=', value: 'team-a' }
    expect(filterSilences(silences, '', [fm])).toEqual(silences)
  })

  it('combines search and label matchers with AND', () => {
    const fm: LabelMatcher = { id: '1', name: '@cluster', operator: '=', value: 'cluster-a' }
    expect(filterSilences(silences, 'web1', [fm])).toEqual([])
  })
})

describe('getExpiredSilence', () => {
  it('returns null when no silences are expired', () => {
    const alert = makeAlert({ status: { inhibitedBy: [], silencedBy: [], state: 'active' } })
    expect(getExpiredSilence(alert, [])).toBeNull()
  })

  it('returns null when an active/pending silence still covers the alert', () => {
    const silence = makeSilence({ id: 's1', status: { state: 'active' } })
    const alert = makeAlert({ status: { inhibitedBy: [], silencedBy: ['s1'], state: 'suppressed' } })
    expect(getExpiredSilence(alert, [silence])).toBeNull()
  })

  it('returns the matching expired silence for the same cluster', () => {
    const silence = makeSilence({
      id: 's1',
      status: { state: 'expired' },
      clusterName: 'cluster-a',
      matchers: [{ name: 'alertname', value: 'X', isEqual: true, isRegex: false }],
    })
    const alert = makeAlert({ clusterName: 'cluster-a', labels: { alertname: 'X' }, status: { inhibitedBy: [], silencedBy: [], state: 'active' } })
    expect(getExpiredSilence(alert, [silence])?.id).toBe('s1')
  })

  it('ignores an expired silence from a different cluster', () => {
    const silence = makeSilence({
      id: 's1',
      status: { state: 'expired' },
      clusterName: 'cluster-b',
      matchers: [{ name: 'alertname', value: 'X', isEqual: true, isRegex: false }],
    })
    const alert = makeAlert({ clusterName: 'cluster-a', labels: { alertname: 'X' }, status: { inhibitedBy: [], silencedBy: [], state: 'active' } })
    expect(getExpiredSilence(alert, [silence])).toBeNull()
  })

  it('picks the most recently expired candidate when several match', () => {
    const older = makeSilence({ id: 'old', status: { state: 'expired' }, clusterName: 'cluster-a', endsAt: '2026-01-01T00:00:00Z', matchers: [{ name: 'alertname', value: 'X', isEqual: true, isRegex: false }] })
    const newer = makeSilence({ id: 'new', status: { state: 'expired' }, clusterName: 'cluster-a', endsAt: '2026-02-01T00:00:00Z', matchers: [{ name: 'alertname', value: 'X', isEqual: true, isRegex: false }] })
    const alert = makeAlert({ clusterName: 'cluster-a', labels: { alertname: 'X' }, status: { inhibitedBy: [], silencedBy: [], state: 'active' } })
    expect(getExpiredSilence(alert, [older, newer])?.id).toBe('new')
  })
})

describe('computeLabelBreakdown', () => {
  it('returns [] for no alerts', () => {
    expect(computeLabelBreakdown([])).toEqual([])
  })

  it('counts occurrences of each label value', () => {
    const alerts = [
      makeAlert({ labels: { alertname: 'X', severity: 'critical', cluster: 'prod' } }),
      makeAlert({ labels: { alertname: 'X', severity: 'critical', cluster: 'prod' } }),
      makeAlert({ labels: { alertname: 'X', severity: 'warning', cluster: 'staging' } }),
    ]
    const breakdown = computeLabelBreakdown(alerts)
    const cluster = breakdown.find((b) => b.name === 'cluster')!
    expect(cluster.total).toBe(3)
    expect(cluster.values).toEqual([
      { value: 'prod', count: 2 },
      { value: 'staging', count: 1 },
    ])
  })

  it('pins alertname and severity to the top regardless of coverage', () => {
    const alerts = [
      makeAlert({ labels: { alertname: 'X', severity: 'critical', instance: 'a', job: 'b', team: 'c' } }),
      makeAlert({ labels: { alertname: 'X', severity: 'critical', instance: 'a', job: 'b', team: 'c' } }),
    ]
    const breakdown = computeLabelBreakdown(alerts)
    expect(breakdown[0].name).toBe('alertname')
    expect(breakdown[1].name).toBe('severity')
  })

  it('orders non-pinned labels by coverage (alerts carrying the label) descending', () => {
    const alerts = [
      makeAlert({ labels: { alertname: 'X', instance: 'a', pod: 'p1' } }),
      makeAlert({ labels: { alertname: 'X', instance: 'b' } }),
      makeAlert({ labels: { alertname: 'X', instance: 'c' } }),
    ]
    const breakdown = computeLabelBreakdown(alerts)
    const names = breakdown.map((b) => b.name)
    expect(names.indexOf('instance')).toBeLessThan(names.indexOf('pod'))
  })

  it('excludes the receiver alias and @receiver pseudo-label (dedicated UI elsewhere)', () => {
    const alerts = [makeAlert({ receivers: [{ name: 'team-a' }] })]
    const breakdown = computeLabelBreakdown(alerts)
    expect(breakdown.find((b) => b.name === 'receiver')).toBeUndefined()
    expect(breakdown.find((b) => b.name === '@receiver')).toBeUndefined()
  })

  it('includes the @cluster pseudo-label', () => {
    const alerts = [makeAlert({ clusterName: 'cluster-a' })]
    const breakdown = computeLabelBreakdown(alerts)
    expect(breakdown.find((b) => b.name === '@cluster')?.values).toEqual([{ value: 'cluster-a', count: 1 }])
  })

  it('caps values per label to maxValues (default 8) and reports the truncated count', () => {
    const alerts = Array.from({ length: 10 }, (_, i) =>
      makeAlert({ labels: { alertname: 'X', instance: `web${i}` } }),
    )
    const breakdown = computeLabelBreakdown(alerts)
    const instance = breakdown.find((b) => b.name === 'instance')!
    expect(instance.values).toHaveLength(8)
    expect(instance.truncated).toBe(2)
  })

  it('respects a custom maxValues option', () => {
    const alerts = Array.from({ length: 5 }, (_, i) =>
      makeAlert({ labels: { alertname: 'X', instance: `web${i}` } }),
    )
    const breakdown = computeLabelBreakdown(alerts, { maxValues: 2 })
    const instance = breakdown.find((b) => b.name === 'instance')!
    expect(instance.values).toHaveLength(2)
    expect(instance.truncated).toBe(3)
  })

  it('caps the number of label names to maxLabels (default 10)', () => {
    const labels: Record<string, string> = { alertname: 'X' }
    for (let i = 0; i < 15; i++) labels[`label${i}`] = 'v'
    const breakdown = computeLabelBreakdown([makeAlert({ labels })])
    expect(breakdown).toHaveLength(10)
  })

  it('respects a custom maxLabels option', () => {
    const labels: Record<string, string> = { alertname: 'X' }
    for (let i = 0; i < 5; i++) labels[`label${i}`] = 'v'
    const breakdown = computeLabelBreakdown([makeAlert({ labels })], { maxLabels: 3 })
    expect(breakdown).toHaveLength(3)
  })

  it('skips empty label values', () => {
    const alerts = [makeAlert({ labels: { alertname: 'X', empty: '' } })]
    const breakdown = computeLabelBreakdown(alerts)
    expect(breakdown.find((b) => b.name === 'empty')).toBeUndefined()
  })
})

describe('findRelatedAlerts', () => {
  it('matches alerts sharing any real label with equal non-empty value', () => {
    const target = makeAlert({ fingerprint: 'a', labels: { alertname: 'X', instance: 'web1' } })
    const related = makeAlert({ fingerprint: 'b', labels: { alertname: 'Y', instance: 'web1' } })
    const unrelated = makeAlert({ fingerprint: 'c', labels: { alertname: 'Z', instance: 'web2' } })
    const result = findRelatedAlerts(target, [target, related, unrelated])
    expect(result).toHaveLength(1)
    expect(result[0].alert.fingerprint).toBe('b')
    expect(result[0].sharedKeys).toEqual(['instance'])
  })

  it('matches on custom (non-identity) labels too — no hardcoded key list', () => {
    const target = makeAlert({ fingerprint: 'a', labels: { alertname: 'X', entity: 'sensor.rack_temp' } })
    const related = makeAlert({ fingerprint: 'b', labels: { alertname: 'Y', entity: 'sensor.rack_temp' } })
    const result = findRelatedAlerts(target, [target, related])
    expect(result).toHaveLength(1)
    expect(result[0].sharedKeys).toEqual(['entity'])
  })

  it('does not match on alertname, severity, receiver, @-pseudo-labels, or empty values', () => {
    const target = makeAlert({
      fingerprint: 'a',
      labels: { alertname: 'X', severity: 'critical', receiver: 'team-a', '@cluster': 'cluster-a', empty: '' },
    })
    const sameSkippedOnly = makeAlert({
      fingerprint: 'b',
      labels: { alertname: 'X', severity: 'critical', receiver: 'team-a', '@cluster': 'cluster-a', empty: '' },
    })
    expect(findRelatedAlerts(target, [target, sameSkippedOnly])).toHaveLength(0)
  })

  it('does not match on URL-valued labels (runbook/dashboard links are metadata, not identity)', () => {
    const target = makeAlert({
      fingerprint: 'a',
      labels: { alertname: 'X', runbook: 'https://runbooks.example.com/X', dashboard: 'http://grafana.example.com/d/1' },
    })
    const sameUrlsOnly = makeAlert({
      fingerprint: 'b',
      labels: { alertname: 'Y', runbook: 'https://runbooks.example.com/X', dashboard: 'http://grafana.example.com/d/1' },
    })
    expect(findRelatedAlerts(target, [target, sameUrlsOnly])).toHaveLength(0)
  })

  it('excludes the target itself by fingerprint + cluster (selection key)', () => {
    const target = makeAlert({ fingerprint: 'a', clusterName: 'cluster-a', labels: { alertname: 'X', instance: 'web1' } })
    const result = findRelatedAlerts(target, [target])
    expect(result).toHaveLength(0)
  })

  it('does not treat the same fingerprint in a different cluster as self', () => {
    const target = makeAlert({ fingerprint: 'a', clusterName: 'cluster-a', labels: { alertname: 'X', instance: 'web1' } })
    const twin = makeAlert({ fingerprint: 'a', clusterName: 'cluster-b', labels: { alertname: 'X', instance: 'web1' } })
    const result = findRelatedAlerts(target, [target, twin])
    expect(result).toHaveLength(1)
    expect(result[0].alert.clusterName).toBe('cluster-b')
  })

  it('allows cross-cluster matches', () => {
    const target = makeAlert({ fingerprint: 'a', clusterName: 'cluster-a', labels: { alertname: 'X', instance: 'web1' } })
    const other = makeAlert({ fingerprint: 'd', clusterName: 'cluster-b', labels: { alertname: 'Y', instance: 'web1' } })
    const result = findRelatedAlerts(target, [target, other])
    expect(result).toHaveLength(1)
    expect(result[0].alert.clusterName).toBe('cluster-b')
  })

  it('weights a rare shared label above a common one (IDF), regardless of shared-key count', () => {
    const now = '2026-01-01T00:00:00Z'
    // `namespace=prod` on every alert (common), `instance=web3` only on target + one candidate (rare).
    const target = makeAlert({ fingerprint: 'a', labels: { alertname: 'X', namespace: 'prod', instance: 'web3' }, startsAt: now })
    const rareMatch = makeAlert({ fingerprint: 'b', labels: { alertname: 'B', instance: 'web3' }, startsAt: now })
    const commonMatch = makeAlert({ fingerprint: 'c', labels: { alertname: 'C', namespace: 'prod' }, startsAt: now })
    const filler = Array.from({ length: 10 }, (_, i) =>
      makeAlert({ fingerprint: `f${i}`, labels: { alertname: `F${i}`, namespace: 'prod' }, startsAt: now }),
    )
    const result = findRelatedAlerts(target, [target, rareMatch, commonMatch, ...filler])
    expect(result[0].alert.fingerprint).toBe('b')
  })

  it('sorts sharedKeys most specific (rarest) first', () => {
    const now = '2026-01-01T00:00:00Z'
    const target = makeAlert({ fingerprint: 'a', labels: { alertname: 'X', namespace: 'prod', instance: 'web3' }, startsAt: now })
    const both = makeAlert({ fingerprint: 'b', labels: { alertname: 'B', namespace: 'prod', instance: 'web3' }, startsAt: now })
    const filler = Array.from({ length: 10 }, (_, i) =>
      makeAlert({ fingerprint: `f${i}`, labels: { alertname: `F${i}`, namespace: 'prod' }, startsAt: now }),
    )
    // `namespace` listed first on the target, but `instance` is rarer → must come first.
    const result = findRelatedAlerts(target, [target, both, ...filler])
    expect(result[0].sharedKeys).toEqual(['instance', 'namespace'])
  })

  it('still relates alerts via a label every alert carries (smoothed IDF, weight > 0)', () => {
    const target = makeAlert({ fingerprint: 'a', labels: { alertname: 'X', instance: 'node1' } })
    const others = Array.from({ length: 4 }, (_, i) =>
      makeAlert({ fingerprint: `b${i}`, labels: { alertname: `B${i}`, instance: 'node1' } }),
    )
    expect(findRelatedAlerts(target, [target, ...others])).toHaveLength(4)
  })

  it('boosts alerts that started close in time to the target', () => {
    const target = makeAlert({ fingerprint: 'a', labels: { alertname: 'X', instance: 'web1' }, startsAt: '2026-01-01T12:00:00Z' })
    const nearInTime = makeAlert({ fingerprint: 'b', labels: { alertname: 'B', instance: 'web1' }, startsAt: '2026-01-01T11:58:00Z' })
    const farInTime = makeAlert({ fingerprint: 'c', labels: { alertname: 'C', instance: 'web1' }, startsAt: '2025-12-01T00:00:00Z' })
    const result = findRelatedAlerts(target, [target, farInTime, nearInTime])
    expect(result.map((r) => r.alert.fingerprint)).toEqual(['b', 'c'])
  })

  it('applies no time boost when a startsAt does not parse', () => {
    const target = makeAlert({ fingerprint: 'a', labels: { alertname: 'X', instance: 'web1' }, startsAt: '2026-01-01T12:00:00Z' })
    const invalidStart = makeAlert({ fingerprint: 'b', labels: { alertname: 'B', instance: 'web1' }, startsAt: 'not-a-date' })
    const boosted = makeAlert({ fingerprint: 'c', labels: { alertname: 'C', instance: 'web1' }, startsAt: '2026-01-01T12:00:00Z' })
    const result = findRelatedAlerts(target, [target, invalidStart, boosted])
    expect(result.map((r) => r.alert.fingerprint)).toEqual(['c', 'b'])
  })

  it('works for a target absent from the snapshot (resolved alert viewed from history)', () => {
    const target = makeAlert({ fingerprint: 'gone', labels: { alertname: 'X', instance: 'web1' } })
    const current = makeAlert({ fingerprint: 'b', labels: { alertname: 'B', instance: 'web1' } })
    const result = findRelatedAlerts(target, [current])
    expect(result).toHaveLength(1)
    expect(result[0].alert.fingerprint).toBe('b')
  })

  it('breaks score ties by severity, then startsAt descending', () => {
    const target = makeAlert({ fingerprint: 'a', labels: { alertname: 'X', instance: 'web1', severity: 'critical' }, startsAt: '2026-01-01T12:00:00Z' })
    // Equidistant from the target (±10min) → identical time boost and score.
    const warningNear = makeAlert({
      fingerprint: 'b',
      labels: { alertname: 'B', instance: 'web1', severity: 'warning' },
      startsAt: '2026-01-01T12:10:00Z',
    })
    const criticalNear = makeAlert({
      fingerprint: 'c',
      labels: { alertname: 'C', instance: 'web1', severity: 'critical' },
      startsAt: '2026-01-01T11:50:00Z',
    })
    const noSeverityNewer = makeAlert({
      fingerprint: 'd',
      labels: { alertname: 'D', instance: 'web1' },
      startsAt: '2026-01-01T12:10:00Z',
    })
    const noSeverityOlder = makeAlert({
      fingerprint: 'e',
      labels: { alertname: 'E', instance: 'web1' },
      startsAt: '2026-01-01T11:50:00Z',
    })
    const result = findRelatedAlerts(target, [target, noSeverityOlder, warningNear, noSeverityNewer, criticalNear])
    // critical beats warning beats missing severity; equal severity → newer startsAt first.
    expect(result.map((r) => r.alert.fingerprint)).toEqual(['c', 'b', 'd', 'e'])
  })

  it('returns an empty result when no eligible labels match', () => {
    const target = makeAlert({ fingerprint: 'a', labels: { alertname: 'X' } })
    const other = makeAlert({ fingerprint: 'b', labels: { alertname: 'Y' } })
    expect(findRelatedAlerts(target, [target, other])).toEqual([])
  })

  it('caps results when a max is given, ranked list stays uncapped by default', () => {
    const target = makeAlert({ fingerprint: 'a', labels: { alertname: 'X', instance: 'web1' } })
    const others = Array.from({ length: 15 }, (_, i) =>
      makeAlert({ fingerprint: `b${i}`, labels: { alertname: `B${i}`, instance: 'web1' } }),
    )
    expect(findRelatedAlerts(target, [target, ...others])).toHaveLength(15)
    expect(findRelatedAlerts(target, [target, ...others], 10)).toHaveLength(10)
  })
})
