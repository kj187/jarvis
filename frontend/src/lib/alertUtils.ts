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
