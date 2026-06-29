import { formatDistanceToNow } from 'date-fns'
import { enUS } from 'date-fns/locale'
import type { EnrichedAlert, LabelMatcher, Silence } from '@/types'

export const tzAbbr = new Date().toLocaleTimeString('en', { timeZoneName: 'short' }).split(' ').pop() ?? ''

// ── Label utilities ────────────────────────────────────────────────────────

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

// ── Regex helper ──────────────────────────────────────────────────────────

export function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern)
  } catch {
    return null
  }
}

// ── Matcher logic ─────────────────────────────────────────────────────────

/**
 * Returns true if the alert matches ALL of the given label matchers.
 * Special handling: receiver/@receiver labels are comma-separated and support partial matching.
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
          return receivers.some((r) => r !== m.value)
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
 * Returns 'active' if the alert is suppressed but its silence expires within
 * 15 minutes (i.e. it will soon become active again).
 * Otherwise returns the raw alert state.
 */
export function getEffectiveAlertState(
  alert: EnrichedAlert,
  silences: Silence[],
): string {
  if (alert.status.state !== 'suppressed') return alert.status.state

  const FIFTEEN_MIN = 15 * 60 * 1000
  const now = Date.now()

  for (const silenceId of alert.status.silencedBy) {
    const silence = silences.find((s) => s.id === silenceId)
    if (silence && silence.status.state === 'active') {
      const endsAt = new Date(silence.endsAt).getTime()
      const remaining = endsAt - now
      if (remaining <= FIFTEEN_MIN) {
        return 'active'
      }
    }
  }
  return 'suppressed'
}

// ── Silence state ─────────────────────────────────────────────────────────

export interface SilenceStateResult {
  type: 'active' | 'expiring' | 'pending' | null
  silence: Silence | null
  remaining?: number
}

export function getSilenceState(alert: EnrichedAlert, silences: Silence[]): SilenceStateResult {
  const FIFTEEN_MIN = 15 * 60 * 1000
  const now = Date.now()
  for (const silenceId of alert.status.silencedBy) {
    const silence = silences.find((s) => s.id === silenceId)
    if (!silence) continue
    const remaining = new Date(silence.endsAt).getTime() - now
    if (silence.status.state === 'pending') return { type: 'pending', silence }
    if (silence.status.state === 'active') {
      if (remaining <= FIFTEEN_MIN) return { type: 'expiring', silence, remaining }
      return { type: 'active', silence, remaining }
    }
  }
  return { type: null, silence: null }
}

/**
 * Returns true if the silence's matchers all match the given alert's labels
 * (including the @cluster pseudo-label).
 */
export function silenceMatchesAlert(silence: Silence, alert: EnrichedAlert): boolean {
  const labels: Record<string, string> = { ...alert.labels, '@cluster': alert.clusterName }
  return silence.matchers.every((m) => {
    const value = labels[m.name] ?? ''
    if (m.isRegex) {
      try {
        const re = new RegExp(m.value)
        return m.isEqual ? re.test(value) : !re.test(value)
      } catch {
        return false
      }
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
