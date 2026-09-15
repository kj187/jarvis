import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { formatMatchers, parseMatchers, readUrlMatchers } from './filterUrl'
import type { LabelMatcher, LabelMatcherOperator } from '@/types'

type M = Omit<LabelMatcher, 'id'>

function m(name: string, operator: LabelMatcherOperator, value: string): M {
  return { name, operator, value }
}

describe('formatMatchers', () => {
  it('renders Alertmanager matcher syntax in braces', () => {
    expect(formatMatchers([m('severity', '=', 'critical'), m('namespace', '=~', 'prod-.*')]))
      .toBe('{severity="critical",namespace=~"prod-.*"}')
  })

  it('renders every operator, including the Jarvis-only @age comparisons', () => {
    expect(formatMatchers([
      m('a', '!=', '1'),
      m('b', '!~', '2'),
      m('@age', '>', '15m'),
      m('@age', '<', '2h'),
    ])).toBe('{a!="1",b!~"2",@age>"15m",@age<"2h"}')
  })

  it('keeps pseudo-label names unquoted and quotes empty values', () => {
    expect(formatMatchers([m('@claimed-by', '!=', '')])).toBe('{@claimed-by!=""}')
  })

  it('escapes backslashes, quotes and newlines in values', () => {
    expect(formatMatchers([m('msg', '=~', 'a"b\\d+\nc')])).toBe('{msg=~"a\\"b\\\\d+\\nc"}')
  })

  it('quotes names containing reserved characters or whitespace', () => {
    expect(formatMatchers([m('foo bar', '=', 'x'), m('a,b', '=', 'y'), m('q"', '=', 'z')]))
      .toBe('{"foo bar"="x","a,b"="y","q\\""="z"}')
  })

  it('renders an empty list as empty braces', () => {
    expect(formatMatchers([])).toBe('{}')
  })
})

describe('parseMatchers', () => {
  it('parses the formatted syntax', () => {
    expect(parseMatchers('{severity="critical",namespace=~"prod-.*"}'))
      .toEqual([m('severity', '=', 'critical'), m('namespace', '=~', 'prod-.*')])
  })

  it('accepts hand-written variants: no braces, whitespace, unquoted values, trailing comma', () => {
    expect(parseMatchers(' severity = critical , env!~"dev|test" , ')).toEqual([
      m('severity', '=', 'critical'),
      m('env', '!~', 'dev|test'),
    ])
    expect(parseMatchers('{ @age > 15m }')).toEqual([m('@age', '>', '15m')])
  })

  it('parses quoted names and escape sequences', () => {
    expect(parseMatchers('{"foo bar"="a\\"b\\\\d\\nc"}')).toEqual([m('foo bar', '=', 'a"b\\d\nc')])
  })

  it('keeps unknown escape sequences literally', () => {
    expect(parseMatchers('{x=~"\\d+"}')).toEqual([m('x', '=~', '\\d+')])
  })

  it('returns an empty list for empty input or empty braces', () => {
    expect(parseMatchers('')).toEqual([])
    expect(parseMatchers('{}')).toEqual([])
    expect(parseMatchers(' { } ')).toEqual([])
  })

  it.each([
    ['{severity="critical"'],
    ['severity="critical"}'],
    ['{severity}'],
    ['{severity=}'],
    ['{="critical"}'],
    ['{""="critical"}'],
    ['{severity=="critical"}'],
    ['{severity~"critical"}'],
    ['{severity="critical}'],
    ['{severity="critical" env="prod"}'],
    ['{a="1",,b="2"}'],
    ['{,}'],
    ['{a="1"}}'],
    ['a="x\\'],
  ])('rejects malformed input %j', (raw) => {
    expect(parseMatchers(raw)).toBeNull()
  })

  it('round-trips any matcher list through formatMatchers', () => {
    const operator = fc.constantFrom<LabelMatcherOperator>('=', '!=', '=~', '!~', '>', '<')
    const matcher = fc.record({ name: fc.string({ minLength: 1 }), operator, value: fc.string() })
    fc.assert(
      fc.property(fc.array(matcher, { maxLength: 6 }), (matchers) => {
        expect(parseMatchers(formatMatchers(matchers))).toEqual(matchers)
      }),
    )
  })
})

describe('readUrlMatchers', () => {
  it('reads the filter parameter', () => {
    const params = new URLSearchParams({ filter: '{severity="critical"}' })
    expect(readUrlMatchers(params)).toEqual([m('severity', '=', 'critical')])
  })

  it('returns null when neither parameter is present or the value is empty', () => {
    expect(readUrlMatchers(new URLSearchParams(''))).toBeNull()
    expect(readUrlMatchers(new URLSearchParams('filter='))).toBeNull()
    expect(readUrlMatchers(new URLSearchParams('matchers='))).toBeNull()
  })

  it('returns null for a malformed filter parameter', () => {
    expect(readUrlMatchers(new URLSearchParams({ filter: '{severity' }))).toBeNull()
  })

  it('still reads legacy JSON matchers links, dropping invalid entries', () => {
    const legacy = JSON.stringify([
      { name: 'severity', operator: '=', value: 'critical' },
      { name: '', operator: '=', value: 'x' },
      { name: 'env', operator: 'LIKE', value: 'prod' },
      'garbage',
    ])
    expect(readUrlMatchers(new URLSearchParams({ matchers: legacy })))
      .toEqual([m('severity', '=', 'critical')])
  })

  it('returns null for legacy matchers that are not a JSON array', () => {
    expect(readUrlMatchers(new URLSearchParams({ matchers: '{nope' }))).toBeNull()
    expect(readUrlMatchers(new URLSearchParams({ matchers: '{"a":1}' }))).toBeNull()
  })

  it('prefers filter over legacy matchers when both are present', () => {
    const params = new URLSearchParams({
      filter: '{env="prod"}',
      matchers: JSON.stringify([{ name: 'severity', operator: '=', value: 'critical' }]),
    })
    expect(readUrlMatchers(params)).toEqual([m('env', '=', 'prod')])
  })
})
