import type { LabelMatcherOperator } from '@/types'
import { isValidSavedFilterMatcher } from '@/lib/settingsUtils'
import type { SavedFilterMatcher } from '@/lib/settingsUtils'

/**
 * URL serialization of the label-matcher chips (`?filter=`), in Alertmanager's
 * matcher syntax: `{severity="critical",namespace=~"prod-.*"}` — the same
 * shape Alertmanager's own UI and amtool use, and ~2.5× shorter than the
 * previous JSON encoding, which let long filters run into proxy request-line
 * limits (ingress-nginx rejects >8 KB with 414) on reload or shared links.
 * Jarvis-only extensions: pseudo-label names (`@cluster`, `@claimed-by`, …)
 * stay unquoted, and `@age` uses `>`/`<`.
 *
 * Serialization only — never evaluates an alert, so it stays out of
 * `lib/alertUtils.ts` (Critical Invariant #4).
 */

export const FILTER_PARAM = 'filter'
/** Pre-`filter` links carried the chips as a JSON array; still read, never written. */
export const LEGACY_MATCHERS_PARAM = 'matchers'

// Longest first, so `=~` is not read as `=` followed by a value starting with `~`.
const OPERATORS: LabelMatcherOperator[] = ['=~', '!~', '!=', '=', '>', '<']
// Characters that end an unquoted token (and force quoting of a name).
const RESERVED = /[\s{}!=~<>,"']/
const WHITESPACE = /\s/

function quote(s: string): string {
  return `"${s.replace(/[\\"\n]/g, (c) => (c === '\n' ? '\\n' : `\\${c}`))}"`
}

/** `{name="value",…}` — values always quoted, names only when they must be. */
export function formatMatchers(matchers: readonly SavedFilterMatcher[]): string {
  const parts = matchers.map(({ name, operator, value }) => {
    const n = name === '' || RESERVED.test(name) ? quote(name) : name
    return `${n}${operator}${quote(value)}`
  })
  return `{${parts.join(',')}}`
}

/**
 * Parses Alertmanager matcher syntax. Lenient where Alertmanager is (optional
 * braces, whitespace, unquoted values, trailing comma); unknown escape
 * sequences inside quotes are kept literally so hand-written regexes like
 * `"\d+"` survive. Returns null on any syntax error or empty label name.
 */
export function parseMatchers(raw: string): SavedFilterMatcher[] | null {
  let input = raw.trim()
  if (input.startsWith('{') !== input.endsWith('}')) return null
  if (input.startsWith('{')) input = input.slice(1, -1)

  let pos = 0
  const skipWhitespace = () => {
    while (pos < input.length && WHITESPACE.test(input[pos])) pos++
  }
  const readToken = (): string | null => {
    if (input[pos] !== '"') {
      const start = pos
      while (pos < input.length && !RESERVED.test(input[pos])) pos++
      return pos > start ? input.slice(start, pos) : null
    }
    let out = ''
    pos++
    while (pos < input.length) {
      const ch = input[pos]
      if (ch === '"') {
        pos++
        return out
      }
      if (ch === '\\') {
        const next = input[pos + 1]
        if (next === undefined) return null
        out += next === 'n' ? '\n' : next === '"' || next === '\\' ? next : ch + next
        pos += 2
        continue
      }
      out += ch
      pos++
    }
    return null // unterminated quote
  }

  const result: SavedFilterMatcher[] = []
  skipWhitespace()
  while (pos < input.length) {
    const name = readToken()
    if (!name) return null
    skipWhitespace()
    const operator = OPERATORS.find((op) => input.startsWith(op, pos))
    if (!operator) return null
    pos += operator.length
    skipWhitespace()
    const value = readToken()
    if (value === null) return null
    result.push({ name, operator, value })
    skipWhitespace()
    if (pos >= input.length) break
    if (input[pos] !== ',') return null
    pos++
    skipWhitespace()
  }
  return result
}

/**
 * The chips carried by the URL, or null when there are none to apply (no or
 * empty parameter, malformed value). `filter` wins; legacy JSON `matchers`
 * links keep working, with invalid entries dropped.
 */
export function readUrlMatchers(params: URLSearchParams): SavedFilterMatcher[] | null {
  const filter = params.get(FILTER_PARAM)
  if (filter) return parseMatchers(filter)
  const legacy = params.get(LEGACY_MATCHERS_PARAM)
  if (!legacy) return null
  try {
    const parsed: unknown = JSON.parse(legacy)
    if (!Array.isArray(parsed)) return null
    return parsed
      .filter(isValidSavedFilterMatcher)
      .map(({ name, operator, value }) => ({ name, operator, value }))
  } catch {
    return null
  }
}
