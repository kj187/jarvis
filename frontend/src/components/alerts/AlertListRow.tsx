import { formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'
import { User } from 'lucide-react'
import { AlertBadge, StatusBadge } from './AlertBadge'
import type { EnrichedAlert } from '@/types'
import { cn } from '@/lib/utils'

interface AlertListRowProps {
  alert: EnrichedAlert
  onClick: (fingerprint: string) => void
  selected: boolean
}

export function AlertListRow({ alert, onClick, selected }: AlertListRowProps) {
  const alertname = alert.labels['alertname'] ?? '—'
  const severity = alert.labels['severity'] ?? 'none'
  const isResolved = alert.status.state === 'resolved'

  return (
    <tr
      role="row"
      tabIndex={0}
      onClick={() => onClick(alert.fingerprint)}
      onKeyDown={(e) => e.key === 'Enter' && onClick(alert.fingerprint)}
      className={cn(
        'cursor-pointer border-b border-border transition-colors hover:bg-accent/50',
        isResolved && 'opacity-50',
        selected && 'bg-accent',
      )}
    >
      <td className="px-4 py-2">
        <AlertBadge severity={severity} />
      </td>
      <td className="px-4 py-2 font-medium">{alertname}</td>
      <td className="px-4 py-2 text-sm text-muted-foreground">{alert.clusterName}</td>
      <td className="px-4 py-2">
        <StatusBadge state={alert.status.state} />
      </td>
      <td className="px-4 py-2 text-sm text-muted-foreground">
        {formatDistanceToNow(new Date(alert.startsAt), { addSuffix: true, locale: de })}
      </td>
      <td className="px-4 py-2 text-sm">
        {alert.activeClaim ? (
          <span className="flex items-center gap-1 text-blue-400">
            <User className="h-3 w-3" />
            {alert.activeClaim.claimedBy}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  )
}
