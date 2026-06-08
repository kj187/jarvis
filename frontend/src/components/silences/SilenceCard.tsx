import { useState } from 'react'
import { Edit, Trash2, Loader2 } from 'lucide-react'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SilenceExpiry } from './SilenceExpiry'
import type { Silence, EnrichedAlert } from '@/types'
import { cn } from '@/lib/utils'

interface SilenceCardProps {
  silence: Silence
  alerts: EnrichedAlert[]
  onEdit: (silence: Silence) => void
  onDelete: (silence: Silence) => void
  isDeleting?: boolean
}

export function SilenceCard({ silence, alerts, onEdit, onDelete, isDeleting = false }: SilenceCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Count affected alerts
  const affectedCount = alerts.filter((a) =>
    a.status.silencedBy.includes(silence.id),
  ).length

  const isExpired = silence.status.state === 'expired'

  return (
    <Card className={cn('relative transition-opacity', isExpired && 'opacity-60', isDeleting && 'opacity-50')}>
      {isDeleting && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/60">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="rounded bg-accent px-2 py-0.5 text-xs">{silence.clusterName}</span>
              <span className={cn(
                'rounded px-2 py-0.5 text-xs font-semibold',
                silence.status.state === 'active' && 'bg-green-900/40 text-green-400',
                silence.status.state === 'pending' && 'bg-slate-800 text-slate-300',
                silence.status.state === 'expired' && 'bg-slate-900 text-slate-500',
              )}>
                {silence.status.state}
              </span>
            </div>
            <SilenceExpiry silence={silence} />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!isExpired && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(silence)}>
                <Edit className="h-3.5 w-3.5" />
              </Button>
            )}
            {confirmDelete ? (
              <div className="flex gap-1">
                <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={() => onDelete(silence)}>
                  Löschen
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setConfirmDelete(false)}>
                  Nein
                </Button>
              </div>
            ) : (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {/* Matchers */}
        <div className="flex flex-wrap gap-1">
          {silence.matchers.map((m, i) => (
            <span key={i} className="rounded bg-accent px-1.5 py-0.5 font-mono text-xs">
              {m.name}{m.isRegex ? (m.isEqual ? '=~' : '!~') : m.isEqual ? '=' : '!='}{m.value}
            </span>
          ))}
        </div>

        {/* Comment */}
        {silence.comment && (
          <p className="text-xs text-muted-foreground line-clamp-2">{silence.comment}</p>
        )}

        {/* Meta */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>von {silence.createdBy}</span>
          <span>Affected: {affectedCount}</span>
        </div>
      </CardContent>
    </Card>
  )
}
