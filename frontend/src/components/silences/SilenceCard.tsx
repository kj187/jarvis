import { BellMinus, Loader2, RotateCcw } from 'lucide-react'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SilenceExpiry } from './SilenceExpiry'
import { labelColorStyle } from '@/components/alerts/LabelChip'
import { useSettingsStore } from '@/store/useSettingsStore'
import type { Silence, EnrichedAlert } from '@/types'
import { cn } from '@/lib/utils'

interface SilenceCardProps {
  silence: Silence
  alerts: EnrichedAlert[]
  onEdit: (silence: Silence) => void
  onExpire: (silence: Silence) => void
  isDeleting?: boolean
}

export function SilenceCard({ silence, alerts, onEdit, onExpire, isDeleting = false }: SilenceCardProps) {
  const theme = useSettingsStore((s) => s.theme)

  const affectedCount = alerts.filter((a) =>
    a.status.silencedBy.includes(silence.id),
  ).length

  const isExpired = silence.status.state === 'expired'

  return (
    <Card
      className={cn(
        'relative border-border/40 transition-colors cursor-pointer hover:bg-muted/50',
        isExpired && 'opacity-60 hover:opacity-100',
        isDeleting && 'opacity-50',
      )}
      onClick={() => onEdit(silence)}
      title={isExpired ? 'Expired — click to re-create' : 'Edit silence'}
    >
      {isDeleting && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/60">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Status badge — top-right */}
      <span className={cn(
        'absolute top-2 right-2 rounded px-2 py-0.5 text-xs font-semibold',
        silence.status.state === 'active' && (theme === 'light' ? 'bg-green-100 text-green-700' : 'bg-green-900/40 text-green-400'),
        silence.status.state === 'pending' && (theme === 'light' ? 'bg-slate-200 text-slate-600' : 'bg-slate-800 text-slate-300'),
        silence.status.state === 'expired' && (theme === 'light' ? 'bg-slate-100 text-slate-500' : 'bg-slate-900 text-slate-500'),
      )}>
        {silence.status.state}
      </span>

      <CardHeader className="pb-2 pr-20">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="rounded bg-accent px-2 py-0.5 text-xs">{silence.clusterName}</span>
          </div>
          <SilenceExpiry silence={silence} />
        </div>
      </CardHeader>

      <CardContent className="space-y-2 pb-10">
        <div className="flex flex-wrap gap-1">
          {silence.matchers.map((m, i) => (
            <span key={i} className="rounded border px-1.5 py-0.5 font-mono text-xs" style={labelColorStyle(m.name, theme)}>
              {m.name}{m.isRegex ? (m.isEqual ? '=~' : '!~') : m.isEqual ? '=' : '!='}{m.value}
            </span>
          ))}
        </div>

        {silence.comment && (
          <p className="text-xs text-muted-foreground line-clamp-2">{silence.comment}</p>
        )}

      </CardContent>

      {/* Bottom-left badges */}
      <div className="absolute bottom-3 left-4 flex gap-1">
        <span className="rounded bg-accent px-1.5 py-0.5 text-xs text-muted-foreground">
          by {silence.createdBy}
        </span>
        <span className="rounded bg-accent px-1.5 py-0.5 text-xs text-muted-foreground">
          Affected: {affectedCount}
        </span>
      </div>

      {/* Action button — bottom-right */}
      {isExpired ? (
        <Button
          variant="ghost"
          size="icon"
          className="absolute bottom-2 right-2 h-7 w-7"
          onClick={(e) => { e.stopPropagation(); onEdit(silence) }}
          title="Re-create silence"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="absolute bottom-2 right-2 h-7 w-7"
          onClick={(e) => { e.stopPropagation(); onExpire(silence) }}
          title="Expire silence"
        >
          <BellMinus className="h-3.5 w-3.5" />
        </Button>
      )}
    </Card>
  )
}
