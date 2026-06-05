import { useState } from 'react'
import { ArrowUpDown } from 'lucide-react'
import { AlertListRow } from './AlertListRow'
import type { EnrichedAlert } from '@/types'
import { severityOrder } from '@/lib/alertUtils'
import { cn } from '@/lib/utils'

interface AlertListViewProps {
  alerts: EnrichedAlert[]
  onSelectAlert: (fingerprint: string) => void
  selectedFingerprint?: string | null
}

type SortKey = 'severity' | 'alertname' | 'cluster' | 'time'

export function AlertListView({ alerts, onSelectAlert, selectedFingerprint }: AlertListViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>('severity')
  const [sortAsc, setSortAsc] = useState(true)

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((v) => !v)
    } else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const sorted = [...alerts].sort((a, b) => {
    let cmp = 0
    switch (sortKey) {
      case 'severity':
        cmp = severityOrder(a.labels['severity'] ?? 'none') - severityOrder(b.labels['severity'] ?? 'none')
        break
      case 'alertname':
        cmp = (a.labels['alertname'] ?? '').localeCompare(b.labels['alertname'] ?? '')
        break
      case 'cluster':
        cmp = a.clusterName.localeCompare(b.clusterName)
        break
      case 'time':
        cmp = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
        break
    }
    return sortAsc ? cmp : -cmp
  })

  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <p className="text-lg">Keine Alerts</p>
      </div>
    )
  }

  function SortHeader({ label, key }: { label: string; key: SortKey }) {
    return (
      <th
        className="cursor-pointer select-none px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
        onClick={() => toggleSort(key)}
      >
        <span className="flex items-center gap-1">
          {label}
          <ArrowUpDown
            className={cn('h-3 w-3', sortKey === key ? 'text-foreground' : 'text-muted-foreground/50')}
          />
        </span>
      </th>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <SortHeader label="Severity" key="severity" />
            <SortHeader label="Alertname" key="alertname" />
            <SortHeader label="Cluster" key="cluster" />
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              State
            </th>
            <SortHeader label="Zeit" key="time" />
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Claim
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((alert) => (
            <AlertListRow
              key={alert.fingerprint}
              alert={alert}
              onClick={onSelectAlert}
              selected={selectedFingerprint === alert.fingerprint}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
