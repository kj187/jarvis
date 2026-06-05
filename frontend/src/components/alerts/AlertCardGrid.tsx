import { AlertCard } from './AlertCard'
import type { EnrichedAlert, Silence } from '@/types'
import { severityOrder } from '@/lib/alertUtils'

interface AlertCardGridProps {
  alerts: EnrichedAlert[]
  silences: Silence[]
  onSelectAlert: (fingerprint: string) => void
  selectedFingerprint?: string | null
}

interface CardGroup {
  alertname: string
  severity: string
  alerts: EnrichedAlert[]
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: '🔴 Critical',
  warning: '🟡 Warning',
  info: '🔵 Info',
  none: '⚫ None',
}

export function AlertCardGrid({
  alerts,
  silences,
  onSelectAlert,
  selectedFingerprint,
}: AlertCardGridProps) {
  // Group by alertname + severity
  const groupMap = new Map<string, CardGroup>()
  for (const alert of alerts) {
    const alertname = alert.labels['alertname'] ?? 'unknown'
    const severity = alert.labels['severity'] ?? 'none'
    const key = `${severity}:${alertname}`
    const existing = groupMap.get(key)
    if (existing) {
      existing.alerts.push(alert)
    } else {
      groupMap.set(key, { alertname, severity, alerts: [alert] })
    }
  }

  // Sort groups by severity, then alertname
  const groups = Array.from(groupMap.values()).sort((a, b) => {
    const sd = severityOrder(a.severity) - severityOrder(b.severity)
    if (sd !== 0) return sd
    return a.alertname.localeCompare(b.alertname)
  })

  // Group by severity for section headers
  const bySeverity = new Map<string, CardGroup[]>()
  for (const g of groups) {
    const existing = bySeverity.get(g.severity) ?? []
    existing.push(g)
    bySeverity.set(g.severity, existing)
  }

  const severities = Array.from(bySeverity.keys()).sort(
    (a, b) => severityOrder(a) - severityOrder(b),
  )

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <p className="text-lg">Keine Alerts</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {severities.map((severity) => (
        <section key={severity}>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {SEVERITY_LABEL[severity] ?? severity}{' '}
            <span className="ml-1 text-muted-foreground">
              ({bySeverity.get(severity)?.reduce((sum, g) => sum + g.alerts.length, 0)})
            </span>
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {bySeverity.get(severity)?.map((group) => (
              <AlertCard
                key={`${group.severity}:${group.alertname}`}
                alerts={group.alerts}
                silences={silences}
                onClick={onSelectAlert}
                selectedFingerprint={selectedFingerprint}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
