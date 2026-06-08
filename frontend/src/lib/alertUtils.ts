import type { EnrichedAlert, LabelMatcher, Silence } from '@/types'

// ── Label utilities ────────────────────────────────────────────────────────

/**
 * Returns an alert's labels augmented with pseudo-labels:
 * - @receiver  (first receiver name)
 * - receiver   (alias for @receiver)
 * - @cluster   (cluster name)
 */
export function getFilterableLabels(alert: EnrichedAlert): Record<string, string> {
  const labels: Record<string, string> = { ...alert.labels }
  const receiver = alert.receivers?.[0]?.name ?? ''
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
    return remMonths > 0 ? `${years}J ${remMonths}M` : `${years}J`
  }
  if (months >= 1) {
    const remDays = days - months * 30
    return remDays > 0 ? `${months}M ${remDays}T` : `${months}M`
  }
  if (days >= 1) {
    const remHours = hours - days * 24
    return remHours > 0 ? `${days}T ${remHours}Std` : `${days}T`
  }
  if (hours >= 1) {
    const remMinutes = minutes - hours * 60
    return remMinutes > 0 ? `${hours}Std ${remMinutes}Min` : `${hours}Std`
  }
  if (minutes >= 1) return `${minutes}Min`
  return '<1Min'
}

// ── Severity ordering ─────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  none: 3,
}

export function severityOrder(severity: string): number {
  return SEVERITY_ORDER[severity] ?? 4
}
