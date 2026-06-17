import { formatDistanceToNow } from 'date-fns'
import { enUS } from 'date-fns/locale'
import type { EnrichedAlert, LabelMatcher, Silence } from '@/types'

export const tzAbbr = new Date().toLocaleTimeString('en', { timeZoneName: 'short' }).split(' ').pop() ?? ''

// ── Label utilities ────────────────────────────────────────────────────────

/**
 * Returns an alert's labels augmented with pseudo-labels:
 * - @receiver  (first receiver name)
 * - receiver   (alias for @receiver)
 * - @cluster   (cluster name)
 */
export function getFilterableLabels(alert: EnrichedAlert): Record<string, string> {
  const labels: Record<string, string> = { ...alert.labels }
  // Resolved alerts from DB have receivers:[] — fall back to the @receiver label stored at index time.
  const receiver = alert.receivers?.[0]?.name ?? labels['@receiver'] ?? ''
  labels['@receiver'] = receiver
  labels['receiver'] = receiver
  labels['@cluster'] = alert.clusterName
  return labels
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
 */
export function matchesLabelMatchers(
  alert: EnrichedAlert,
  matchers: LabelMatcher[],
): boolean {
  if (matchers.length === 0) return true
  const labels = getFilterableLabels(alert)
  return matchers.every((m) => {
    const value = labels[m.name] ?? ''
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
