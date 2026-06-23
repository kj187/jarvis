import { useEffect, useState } from 'react'
import { AlertCard } from './AlertCard'
import { Sheet } from '@/components/ui/sheet'
import { SilenceForm } from '@/components/silences/SilenceForm'
import { useQuery } from '@tanstack/react-query'
import { fetchClusters } from '@/api/client'
import type { EnrichedAlert, Silence } from '@/types'
import { severityOrder } from '@/lib/alertUtils'

interface AlertCardGridProps {
  alerts: EnrichedAlert[]
  silences: Silence[]
  onSelectAlert: (fingerprint: string) => void
  selectedFingerprint?: string | null
  resolvedMode?: boolean
}

interface CardGroup {
  alertname: string
  severity: string
  alerts: EnrichedAlert[]
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Critical',
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
  none: 'None',
}

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  error: 'bg-orange-500',
  warning: 'bg-yellow-500',
  info: 'bg-blue-500',
  none: 'bg-slate-500',
}

const PAGE_SIZE = 3

function useColumns(): number {
  const [cols, setCols] = useState(() => {
    const w = window.innerWidth
    if (w >= 1536) return 4
    if (w >= 1280) return 3
    if (w >= 640) return 2
    return 1
  })
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      if (w >= 1536) setCols(4)
      else if (w >= 1280) setCols(3)
      else if (w >= 640) setCols(2)
      else setCols(1)
    }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return cols
}

// Rough height estimate in pixels for bin-packing.
// Avoids DOM measurement; good enough for balanced distribution.
function estimateHeight(group: CardGroup, silences: Silence[]): number {
  const visibleEntries = Math.min(group.alerts.length, PAGE_SIZE)
  let h = 40 // card header
  for (let i = 0; i < visibleEntries; i++) {
    const alert = group.alerts[i]
    h += 20 // timestamp row
    // silence banner
    const silenced = alert.status.silencedBy.some((id) =>
      silences.find((s) => s.id === id && s.status.state !== 'expired'),
    )
    if (silenced) h += 48
    const labelCount = Object.keys(alert.labels).length
    h += Math.ceil(labelCount / 4) * 22 // label chips (wrap estimate)
    if (alert.annotations['summary']) h += 18
    if (alert.annotations['description']) h += 18
    h += 8 // entry padding + gap
  }
  if (group.alerts.length > PAGE_SIZE) h += 44 // pagination bar
  return h
}

// Greedy bin-packing (LPT): sort tallest first so left columns fill first.
// Ties broken by lowest index → left columns fill first.
function distributeColumns(groups: CardGroup[], silences: Silence[], numCols: number): CardGroup[][] {
  const cols: CardGroup[][] = Array.from({ length: numCols }, () => [])
  const heights = Array(numCols).fill(0)
  const sorted = [...groups].sort((a, b) => estimateHeight(b, silences) - estimateHeight(a, silences))
  for (const group of sorted) {
    let minIdx = 0
    for (let i = 1; i < numCols; i++) {
      if (heights[i] < heights[minIdx]) minIdx = i
    }
    cols[minIdx].push(group)
    heights[minIdx] += estimateHeight(group, silences)
  }
  return cols
}

export function AlertCardGrid({
  alerts,
  silences,
  onSelectAlert,
  selectedFingerprint,
  resolvedMode,
}: AlertCardGridProps) {
  const numCols = useColumns()

  const [silenceAlerts, setSilenceAlerts] = useState<EnrichedAlert[] | null>(null)
  const { data: clusters = [] } = useQuery({ queryKey: ['clusters'], queryFn: fetchClusters })
  const clusterNames = clusters.map((c) => c.name)

  const silenceSheet = (
    <Sheet
      open={silenceAlerts !== null}
      onClose={() => setSilenceAlerts(null)}
      className="sm:max-w-2xl lg:max-w-3xl"
    >
      {silenceAlerts && (
        <div className="p-5 pt-10">
          <h2 className="mb-4 text-base font-semibold">Create silence</h2>
          <SilenceForm
            availableClusters={
              clusterNames.length > 0
                ? clusterNames
                : [...new Set(silenceAlerts.map((a) => a.clusterName))]
            }
            prefillAlerts={silenceAlerts}
            onSuccess={() => setSilenceAlerts(null)}
            onCancel={() => setSilenceAlerts(null)}
          />
        </div>
      )}
    </Sheet>
  )

  // Resolved mode: flat grid sorted by endsAt desc, each alert is its own card
  if (resolvedMode) {
    const sorted = [...alerts].sort(
      (a, b) => new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime(),
    )
    if (sorted.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <p className="text-lg">No alerts</p>
        </div>
      )
    }
    const cols: EnrichedAlert[][] = Array.from({ length: numCols }, () => [])
    sorted.forEach((alert, i) => cols[i % numCols].push(alert))
    return (
      <>
        <div className="flex gap-3">
          {cols.map((colAlerts, colIdx) => (
            <div key={colIdx} className="flex min-w-0 flex-1 flex-col gap-3">
              {colAlerts.map((alert) => (
                <AlertCard
                  key={alert.fingerprint}
                  alerts={[alert]}
                  silences={silences}
                  onClick={onSelectAlert}
                  selectedFingerprint={selectedFingerprint}
                  onCreateSilence={setSilenceAlerts}
                />
              ))}
            </div>
          ))}
        </div>
        {silenceSheet}
      </>
    )
  }

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
      <>
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <p className="text-lg">No alerts</p>
        </div>
        {silenceSheet}
      </>
    )
  }

  return (
    <>
    <div className="space-y-4">
      {severities.map((severity) => {
        const sectionGroups = bySeverity.get(severity) ?? []
        const distributed = distributeColumns(sectionGroups, silences, numCols)
        return (
          <section key={severity}>
            <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span className={`h-2 w-2 rounded-full shrink-0 ${SEVERITY_DOT[severity] ?? 'bg-slate-500'}`} />
              {SEVERITY_LABEL[severity] ?? severity}{' '}
              <span className="ml-1 text-muted-foreground">
                ({sectionGroups.reduce((sum, g) => sum + g.alerts.length, 0)})
              </span>
            </h2>
            <div className="flex gap-3">
              {distributed.map((colGroups, colIdx) => (
                <div key={colIdx} className="flex min-w-0 flex-1 flex-col gap-3">
                  {colGroups.map((group) => (
                    <AlertCard
                      key={`${group.severity}:${group.alertname}`}
                      alerts={group.alerts}
                      silences={silences}
                      onClick={onSelectAlert}
                      selectedFingerprint={selectedFingerprint}
                      onCreateSilence={setSilenceAlerts}
                    />
                  ))}
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
    {silenceSheet}
    </>
  )
}
