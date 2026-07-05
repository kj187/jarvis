import { formatDistanceToNow } from 'date-fns'
import { enUS } from 'date-fns/locale'
import type React from 'react'
import type { UpsertSilenceBody } from '@/api/client'
import type { EnrichedAlert, LabelMatcher, Silence } from '@/types'

export const tzAbbr = new Date().toLocaleTimeString('en', { timeZoneName: 'short' }).split(' ').pop() ?? ''

// ── Label utilities ────────────────────────────────────────────────────────

/** Label keys rendered by dedicated UI elements instead of generic label chips. */
export const HIDDEN_LABEL_KEYS = new Set(['alertname', 'severity', 'receiver', '@receiver'])

/** Deterministic per-key chip colors (djb2 hash → hue). */
export function labelColorStyle(key: string, theme: 'dark' | 'light' = 'dark'): React.CSSProperties {
  let h = 5381
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0
  const hue = h % 360
  if (theme === 'light') {
    return {
      backgroundColor: `hsl(${hue} 50% 90%)`,
      color: `hsl(${hue} 70% 28%)`,
      borderColor: `hsl(${hue} 40% 70%)`,
    }
  }
  return {
    backgroundColor: `hsl(${hue} 40% 16%)`,
    color: `hsl(${hue} 70% 72%)`,
    borderColor: `hsl(${hue} 35% 30%)`,
  }
}

/**
 * Returns an alert's labels augmented with pseudo-labels:
 * - @receiver  (comma-separated list of all receiver names)
 * - receiver   (alias for @receiver)
 * - @cluster   (cluster name)
 */
export function getFilterableLabels(alert: EnrichedAlert): Record<string, string> {
  const labels: Record<string, string> = { ...alert.labels }
  // Get receiver names from the receivers array or fall back to @receiver label.
  let receiverList: string
  if (alert.receivers && alert.receivers.length > 0) {
    receiverList = alert.receivers.map((r) => r.name).join(',')
  } else {
    receiverList = labels['@receiver'] ?? ''
  }
  labels['@receiver'] = receiverList
  labels['receiver'] = receiverList
  labels['@cluster'] = alert.clusterName
  return labels
}

// ── Affected-alert identifier ──────────────────────────────────────────────

/**
 * Picks the single most useful label key to distinguish a set of affected
 * alerts: the differing label (skipping alertname/severity) with the highest
 * number of distinct values across the set. Returns null when nothing differs.
 */
export function pickIdentifierLabel(
  alerts: EnrichedAlert[],
  skip: string[] = ['alertname', 'severity'],
): string | null {
  if (alerts.length === 0) return null
  const allKeys = [...new Set(alerts.flatMap((a) => Object.keys(a.labels)))]
  let best: string | null = null
  let bestCardinality = 1
  for (const k of allKeys) {
    if (skip.includes(k)) continue
    const distinct = new Set(alerts.map((a) => a.labels[k] ?? '')).size
    if (distinct > bestCardinality) {
      bestCardinality = distinct
      best = k
    }
  }
  return best
}

// ── Regex helpers ────────────────────────────────────────────────────────

export function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern)
  } catch {
    return null
  }
}

/**
 * Alertmanager-anchored regex: full-string match (`^(?:pattern)$`), matching
 * how Alertmanager compiles a matcher's regex (RE2, fully anchored).
 * `new RegExp(pattern).test(value)` is substring matching and diverges from
 * AM in both directions — `instance=~"web1"` would appear to also match
 * `web10`, and `instance!~"web"` would appear to NOT match `web1` even
 * though AM's anchored negative match silences it (`^(?:web)$` doesn't match
 * `web1`, so `!~` is true). Returns null for patterns that don't compile as
 * a JS RegExp — such a pattern may still be valid RE2 (e.g. inline flags
 * like `(?i)`); see `hasUnevaluableRegexMatcher` for surfacing that case.
 */
export function anchoredRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(`^(?:${pattern})$`)
  } catch {
    return null
  }
}

// ── Matcher logic ─────────────────────────────────────────────────────────

/**
 * Returns true if the alert matches ALL of the given label matchers, for
 * the alerts-page/silences-page **filter bar** — deliberately lenient UI
 * filtering, not Alertmanager matching semantics: substring regex (not
 * anchored) and receiver/@receiver pseudo-labels with comma-list partial
 * matching. Do NOT use this to decide what a silence would actually cover —
 * that is `silenceWouldMatchAlert`, which mirrors AM's anchored, pseudo-label-free
 * semantics exactly.
 */
export function matchesLabelMatchers(
  alert: EnrichedAlert,
  matchers: LabelMatcher[],
): boolean {
  if (matchers.length === 0) return true
  const labels = getFilterableLabels(alert)
  return matchers.every((m) => {
    const value = labels[m.name] ?? ''
    // Special handling for receiver/@receiver: they are comma-separated lists.
    // For equality operators, check if any receiver matches.
    if ((m.name === 'receiver' || m.name === '@receiver') && value.includes(',')) {
      const receivers = value.split(',').map((r) => r.trim())
      switch (m.operator) {
        case '=':
          return receivers.includes(m.value)
        case '!=':
          // Matches only if NONE of the alert's receivers is the excluded one —
          // consistent with `!~` below (also `every`); `some` here would make
          // `receiver!=a` match an alert whose receivers are [a, b] just
          // because b !== a.
          return receivers.every((r) => r !== m.value)
        case '=~': {
          const re = safeRegex(m.value)
          return re ? receivers.some((r) => re.test(r)) : false
        }
        case '!~': {
          const re = safeRegex(m.value)
          return re ? receivers.every((r) => !re.test(r)) : true
        }
      }
    }
    // Standard matching for other labels
    switch (m.operator) {
      case '=':
        return value === m.value
      case '!=':
        return value !== m.value
      case '=~': {
        const re = safeRegex(m.value)
        return re ? re.test(value) : false
      }
      case '!~': {
        const re = safeRegex(m.value)
        return re ? !re.test(value) : true
      }
    }
  })
}

/**
 * True if any regex matcher's pattern doesn't compile as a JS RegExp (e.g.
 * RE2-only syntax like `(?i)`), meaning `silenceWouldMatchAlert` couldn't
 * evaluate it client-side and had to assume a match conservatively. Callers
 * (the silence-preview UI) should surface this instead of trusting an
 * "0 affected alerts" count at face value.
 */
export function hasUnevaluableRegexMatcher(matchers: LabelMatcher[]): boolean {
  return matchers.some(
    (m) => (m.operator === '=~' || m.operator === '!~') && anchoredRegex(m.value) === null,
  )
}

/**
 * True if the given matchers would match the alert in Alertmanager: anchored
 * regex (not substring), evaluated only against the alert's real labels —
 * no `@cluster`/`@receiver`/`receiver` pseudo-labels, since those don't
 * exist as real Alertmanager labels (a matcher naming them targets the empty
 * string there, not the UI's synthesized value). A missing label is treated
 * as the empty string, matching AM's own matcher semantics. Used by
 * `SilenceForm`'s affected-alerts preview and overlap detection — NOT the
 * filter bar, which intentionally stays lenient (see `matchesLabelMatchers`).
 *
 * A regex matcher whose pattern doesn't compile in JS is conservatively
 * treated as matching (see `hasUnevaluableRegexMatcher`): under-counting
 * affected alerts is the dangerous direction (a silence created from a
 * preview showing "0 affected" that actually silences alerts in
 * Alertmanager); over-counting is not.
 */
export function silenceWouldMatchAlert(matchers: LabelMatcher[], alert: EnrichedAlert): boolean {
  return matchers.every((m) => {
    const value = alert.labels[m.name] ?? ''
    switch (m.operator) {
      case '=':
        return value === m.value
      case '!=':
        return value !== m.value
      case '=~': {
        const re = anchoredRegex(m.value)
        return re ? re.test(value) : true
      }
      case '!~': {
        const re = anchoredRegex(m.value)
        return re ? !re.test(value) : true
      }
    }
  })
}

// ── Silence filtering ─────────────────────────────────────────────────────

export function filterSilences(
  silences: Silence[],
  search: string,
  labelMatchers: LabelMatcher[],
): Silence[] {
  let result = silences

  if (search) {
    const q = search.toLowerCase()
    result = result.filter((s) =>
      s.comment?.toLowerCase().includes(q) ||
      s.createdBy?.toLowerCase().includes(q) ||
      s.matchers.some((m) => m.name.toLowerCase().includes(q) || m.value.toLowerCase().includes(q))
    )
  }

  if (labelMatchers.length > 0) {
    result = result.filter((s) =>
      labelMatchers.every((fm) => {
        if (fm.name === '@cluster') {
          const v = s.clusterName
          switch (fm.operator) {
            case '=':  return v === fm.value
            case '!=': return v !== fm.value
            case '=~': return safeRegex(fm.value)?.test(v) ?? false
            case '!~': return !(safeRegex(fm.value)?.test(v) ?? false)
          }
        }
        // @receiver / receiver are alert pseudo-labels — silences have no receiver field, skip
        if (fm.name === '@receiver' || fm.name === 'receiver') return true
        return s.matchers.some((m) => {
          if (m.name !== fm.name) return false
          switch (fm.operator) {
            case '=':  return m.value === fm.value
            case '!=': return m.value !== fm.value
            case '=~': return safeRegex(fm.value)?.test(m.value) ?? false
            case '!~': return !(safeRegex(fm.value)?.test(m.value) ?? false)
          }
        })
      })
    )
  }

  return result
}

// ── Effective alert state ─────────────────────────────────────────────────

/**
 * Returns 'active' if the alert is suppressed but ALL active silences
 * currently covering it (`status.silencedBy`) expire within 15 minutes —
 * i.e. it will soon become active again regardless of which one runs out
 * last. Otherwise returns the raw alert state. An alert can be covered by
 * more than one silence at once; looking only at the first one found in
 * `silencedBy` (as opposed to the one with the latest `endsAt`) could flip
 * the effective state early while a longer-running silence still applies.
 */
export function getEffectiveAlertState(
  alert: EnrichedAlert,
  silences: Silence[],
): string {
  if (alert.status.state !== 'suppressed') return alert.status.state

  const FIFTEEN_MIN = 15 * 60 * 1000
  const now = Date.now()

  let maxRemaining: number | null = null
  for (const silenceId of alert.status.silencedBy) {
    const silence = silences.find((s) => s.id === silenceId)
    if (!silence || silence.status.state !== 'active') continue
    const remaining = new Date(silence.endsAt).getTime() - now
    if (maxRemaining === null || remaining > maxRemaining) maxRemaining = remaining
  }
  if (maxRemaining !== null && maxRemaining <= FIFTEEN_MIN) return 'active'
  return 'suppressed'
}

// ── Silence state ─────────────────────────────────────────────────────────

export interface SilenceStateResult {
  type: 'active' | 'expiring' | 'pending' | null
  silence: Silence | null
  remaining?: number
}

/**
 * Picks the silence that best represents the alert's current suppression:
 * among all ACTIVE silences in `silencedBy`, the one with the latest
 * `endsAt` (the one that actually determines when the alert goes loud
 * again) — checked before any pending silence, since a pending silence
 * doesn't suppress anything yet.
 */
export function getSilenceState(alert: EnrichedAlert, silences: Silence[]): SilenceStateResult {
  const FIFTEEN_MIN = 15 * 60 * 1000
  const now = Date.now()

  let best: { silence: Silence; remaining: number } | null = null
  let pending: Silence | null = null
  for (const silenceId of alert.status.silencedBy) {
    const silence = silences.find((s) => s.id === silenceId)
    if (!silence) continue
    if (silence.status.state === 'pending' && !pending) pending = silence
    if (silence.status.state === 'active') {
      const remaining = new Date(silence.endsAt).getTime() - now
      if (!best || remaining > best.remaining) best = { silence, remaining }
    }
  }
  if (best) {
    return best.remaining <= FIFTEEN_MIN
      ? { type: 'expiring', silence: best.silence, remaining: best.remaining }
      : { type: 'active', silence: best.silence, remaining: best.remaining }
  }
  if (pending) return { type: 'pending', silence: pending }
  return { type: null, silence: null }
}

/**
 * Returns true if the silence's matchers would match the alert in
 * Alertmanager: anchored regex, evaluated only against the alert's real
 * labels (no `@cluster` pseudo-label — no real Alertmanager label has that
 * name, and cluster scoping is handled separately via `clusterName`
 * comparisons at call sites). See `silenceWouldMatchAlert` for the
 * equivalent used on the (differently-shaped) `LabelMatcher[]` the silence
 * form works with, including the unparseable-regex rationale.
 */
export function silenceMatchesAlert(silence: Silence, alert: EnrichedAlert): boolean {
  return silence.matchers.every((m) => {
    const value = alert.labels[m.name] ?? ''
    if (m.isRegex) {
      const re = anchoredRegex(m.value)
      return re ? (m.isEqual ? re.test(value) : !re.test(value)) : true
    }
    return m.isEqual ? value === m.value : value !== m.value
  })
}

/**
 * Returns the most recently expired silence that matched the alert, but only
 * when no active/pending silence currently covers it. Alertmanager creates a
 * new ID on every edit (expiring the old one), so showing an expired entry
 * alongside an active one would always surface the predecessor.
 */
export function getExpiredSilence(alert: EnrichedAlert, silences: Silence[]): Silence | null {
  if (alert.status.silencedBy.some((id) => silences.some((s) => s.id === id))) return null
  const candidates = silences
    .filter(
      (s) =>
        s.status.state === 'expired' &&
        s.clusterName === alert.clusterName &&
        silenceMatchesAlert(s, alert),
    )
    .sort((a, b) => new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime())
  return candidates[0] ?? null
}

export function formatSilenceDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const months = Math.floor(days / 30)
  const years = Math.floor(days / 365)
  if (years >= 1) {
    const remMonths = Math.floor((days - years * 365) / 30)
    return remMonths > 0 ? `${years}y ${remMonths}mo` : `${years}y`
  }
  if (months >= 1) {
    const remDays = days - months * 30
    return remDays > 0 ? `${months}mo ${remDays}d` : `${months}mo`
  }
  if (days >= 1) {
    const remHours = hours - days * 24
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`
  }
  if (hours >= 1) {
    const remMinutes = minutes - hours * 60
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`
  }
  if (minutes >= 1) return `${minutes}m`
  return '<1m'
}

// ── Time formatting ───────────────────────────────────────────────────────────

/**
 * Formats a date as relative ("2h ago") or absolute ("Jun 5, 2025, 2:30 PM").
 * Pass the user's timeFormat preference explicitly — no store dependency.
 */
export function formatTime(
  date: Date | string,
  format: 'relative' | 'absolute',
): string {
  const d = new Date(date)
  if (format === 'absolute') {
    return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) + ' ' + tzAbbr
  }
  return formatDistanceToNow(d, { addSuffix: true, locale: enUS })
}

// ── Severity ordering ─────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
  none: 4,
}

export function severityOrder(severity: string): number {
  return SEVERITY_ORDER[severity] ?? 5
}

// ── One-click acknowledgement ─────────────────────────────────────────────

/** Duration choices offered by the one-click Fast-Silence menu (shortest → longest). */
export const FAST_SILENCE_DURATIONS: ReadonlyArray<{ label: string; minutes: number }> = [
  { label: '5m', minutes: 5 },
  { label: '10m', minutes: 10 },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '4h', minutes: 240 },
  { label: '1d', minutes: 1440 },
  { label: '1w', minutes: 10080 },
]

/**
 * Human-readable Fast-Silence duration. Exact multiples collapse to a single
 * unit — `Xw` (weeks) → `Xd` (days) → `Xh` (hours) → `Xm` (minutes); mixed
 * hour/minute values fall back to `Xh Ym`. Kept in sync with the labels in
 * `FAST_SILENCE_DURATIONS` (5m, 10m, 15m, 30m, 1h, 4h, 1d, 1w).
 */
export function formatAckDuration(minutes: number): string {
  if (minutes > 0 && minutes % 10080 === 0) return `${minutes / 10080}w`
  if (minutes > 0 && minutes % 1440 === 0) return `${minutes / 1440}d`
  if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60}h`
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return `${hours}h ${rem}m`
}

/**
 * Builds the silence body for a one-click acknowledgement: an exact-match
 * (isEqual/non-regex) silence on the alert's real labels, targeting exactly
 * this one alert instance for `durationMinutes`. Pseudo-labels that do not
 * exist on the real Alertmanager alert (`@receiver`, `@cluster`, `receiver`,
 * and any other `@`-prefixed key) are skipped — including them would make the
 * matchers never match in Alertmanager, so the silence would suppress nothing.
 * Same skip set as SilenceForm's `buildPrefillMatchers`. Matchers are sorted by
 * name for deterministic output. Passing `fingerprint` makes the backend record
 * a SilenceEvent on the alert timeline.
 */
export function buildAckSilenceBody(
  alert: EnrichedAlert,
  durationMinutes: number,
  createdBy: string,
): UpsertSilenceBody {
  const now = new Date()
  const endsAt = new Date(now.getTime() + durationMinutes * 60_000)
  const matchers = Object.entries(alert.labels)
    .filter(([name, value]) => Boolean(value) && !name.startsWith('@') && name !== 'receiver')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ({ isEqual: true, isRegex: false, name, value }))
  return {
    cluster: alert.clusterName,
    matchers,
    startsAt: now.toISOString(),
    endsAt: endsAt.toISOString(),
    createdBy,
    performedBy: createdBy,
    comment: `Fast-Silence for ${formatAckDuration(durationMinutes)}`,
    fingerprint: alert.fingerprint,
  }
}

/** Escapes regex metacharacters so a raw label value is safe to embed in an Alertmanager regex matcher. */
export function escapeRegexValue(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const GROUP_MATCHER_SKIP = new Set(['receiver', '@receiver', '@cluster'])

/**
 * For a group of alerts, computes each real label's distinct value set —
 * the shared basis for both `SilenceForm`'s group prefill and one-click group
 * Fast-Silence, so both default to the same silence scope. A label with a
 * single distinct value is common across the group (exact match); more than
 * one value means it varies per alert (regex OR match).
 *
 * Only labels present on EVERY alert in the group are included. A label that
 * exists only on some alerts is dropped rather than turned into a matcher —
 * the natural first instinct (an anchored regex OR-matching only the values
 * that do exist) would silently exclude every alert lacking that label,
 * since a missing label matches the empty string in Alertmanager and would
 * never be one of the listed values. That would silence part of the group
 * while the rest keeps firing, with nothing in the UI showing the gap for
 * one-click Fast-Silence (no preview step). Dropping the label instead keeps
 * the resulting matchers a strict superset of "still covers every alert
 * actually in the group" — at the cost of being defined only by the labels
 * alerts share, which can silence a broader class of alerts than just these
 * (matching Alertmanager's and this form's own usual silence-by-label-set
 * semantics, not a fingerprint-exact scope).
 */
export function computeGroupLabelValues(alerts: EnrichedAlert[]): Array<{ name: string; values: string[] }> {
  if (alerts.length === 0) return []
  const allKeys = new Set<string>()
  for (const k of Object.keys(alerts[0].labels)) {
    if (!GROUP_MATCHER_SKIP.has(k)) allKeys.add(k)
  }
  const result: Array<{ name: string; values: string[] }> = []
  for (const key of allKeys) {
    if (!alerts.every((a) => Boolean(a.labels[key]))) continue
    const values = [...new Set(alerts.map((a) => a.labels[key]))]
    result.push({ name: key, values })
  }
  return result
}

/**
 * Builds the silence body for a one-click *group* Fast-Silence covering all
 * of `alerts`, which must belong to a single cluster (callers — currently
 * only `useGroupAckAlert`, which pre-groups by `clusterName` — are
 * responsible for that; see its per-cluster fan-out). Matchers come from
 * `computeGroupLabelValues` — exact match on labels shared by every alert in
 * the group, escaped-regex OR-match on labels that additionally vary. This
 * is exactly what `SilenceForm`'s "Silence…" would default to for the same
 * alerts, just submitted immediately instead of opened for review.
 */
export function buildGroupAckSilenceBody(
  alerts: EnrichedAlert[],
  durationMinutes: number,
  createdBy: string,
): UpsertSilenceBody {
  const clusterNames = new Set(alerts.map((a) => a.clusterName))
  if (clusterNames.size > 1) {
    throw new Error(`buildGroupAckSilenceBody: alerts span multiple clusters (${[...clusterNames].join(', ')})`)
  }
  const now = new Date()
  const endsAt = new Date(now.getTime() + durationMinutes * 60_000)
  const matchers = computeGroupLabelValues(alerts)
    .map(({ name, values }) =>
      values.length === 1
        ? { isEqual: true, isRegex: false, name, value: values[0] }
        : { isEqual: true, isRegex: true, name, value: values.map(escapeRegexValue).join('|') },
    )
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    cluster: alerts[0].clusterName,
    matchers,
    startsAt: now.toISOString(),
    endsAt: endsAt.toISOString(),
    createdBy,
    performedBy: createdBy,
    comment: `Fast-Silence for ${formatAckDuration(durationMinutes)}`,
  }
}
