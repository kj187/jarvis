import { useState } from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import { de } from 'date-fns/locale'
import { ChevronDown, Trash2 } from 'lucide-react'
import type { AlertEvent } from '@/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface AlertHistoryTableProps {
  events: AlertEvent[]
  total: number
  onLoadMore: () => void
  loading?: boolean
}

const eventStatusColor: Record<string, string> = {
  firing: 'text-red-400',
  suppressed: 'text-slate-400',
  expired: 'text-yellow-400',
  resolved: 'text-green-400',
}

function duration(startsAt: string, endsAt: string | null): string {
  if (!endsAt) return 'laufend'
  const diff = new Date(endsAt).getTime() - new Date(startsAt).getTime()
  if (diff < 60_000) return `${Math.round(diff / 1000)}s`
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`
  return `${Math.round(diff / 3_600_000)}h`
}

export function AlertHistoryTable({
  events,
  total,
  onLoadMore,
  loading,
}: AlertHistoryTableProps) {
  return (
    <div>
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-accent/30">
              <th className="px-3 py-2 text-left text-muted-foreground">Status</th>
              <th className="px-3 py-2 text-left text-muted-foreground">Start</th>
              <th className="px-3 py-2 text-left text-muted-foreground">Ende</th>
              <th className="px-3 py-2 text-left text-muted-foreground">Dauer</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-b border-border last:border-0">
                <td className={cn('px-3 py-2 font-medium', eventStatusColor[e.status] ?? 'text-foreground')}>
                  {e.status}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {format(new Date(e.startsAt), 'dd.MM. HH:mm', { locale: de })}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {e.endsAt ? format(new Date(e.endsAt), 'dd.MM. HH:mm', { locale: de }) : '—'}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{duration(e.startsAt, e.endsAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {events.length < total && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full text-xs"
          onClick={onLoadMore}
          disabled={loading}
        >
          <ChevronDown className="mr-1 h-3 w-3" />
          Ältere laden ({total - events.length} mehr)
        </Button>
      )}
    </div>
  )
}
