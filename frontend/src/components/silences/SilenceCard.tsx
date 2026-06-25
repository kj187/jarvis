import { BellMinus, Loader2, RotateCcw } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SilenceExpiry } from './SilenceExpiry'
import { labelColorStyle } from '@/components/alerts/LabelChip'
import { TruncatableChip } from '@/components/ui/truncatable-chip'
import { useSettingsStore } from '@/store/useSettingsStore'
import type { EnrichedAlert, Silence } from '@/types'
import { cn } from '@/lib/utils'

interface SilenceCardProps {
  silence: Silence
  alerts: EnrichedAlert[]
  onEdit: (silence: Silence) => void
  onExpire: (silence: Silence) => void
  isDeleting?: boolean
}

function stateBadgeClass(state: string, theme: string): string {
  if (state === 'active') return theme === 'light' ? 'bg-green-100 text-green-700' : 'bg-green-900/40 text-green-400'
  if (state === 'pending') return theme === 'light' ? 'bg-slate-200 text-slate-700' : 'bg-slate-700 text-slate-200'
  return theme === 'light' ? 'bg-slate-100 text-slate-500' : 'bg-slate-900 text-slate-500'
}

function matcherOperator(isRegex: boolean, isEqual: boolean): string {
  if (isRegex) return isEqual ? '=~' : '!~'
  return isEqual ? '=' : '!='
}

export function SilenceCard({ silence, alerts, onEdit, onExpire, isDeleting = false }: SilenceCardProps) {
  const theme = useSettingsStore((s) => s.theme)
  const affectedCount = alerts.reduce(
    (sum, alert) => sum + (alert.status.silencedBy.includes(silence.id) ? 1 : 0),
    0,
  )

  const isExpired = silence.status.state === 'expired'
  const visibleMatchers = silence.matchers.slice(0, 4)
  const hiddenMatcherCount = Math.max(0, silence.matchers.length - visibleMatchers.length)

  return (
    <Card
      className={cn(
        'group relative overflow-hidden border-border/40 bg-card/70 transition-all cursor-pointer hover:border-border hover:bg-muted/30 hover:shadow-md',
        isExpired && 'opacity-75 hover:opacity-100',
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

      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn('rounded-md px-2 py-0.5 text-xs font-semibold', stateBadgeClass(silence.status.state, theme))}>
              {silence.status.state}
            </span>
            <span className="rounded-md bg-accent px-2 py-0.5 text-xs">{silence.clusterName}</span>
          </div>
          {isExpired ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={(e) => { e.stopPropagation(); onEdit(silence) }}
              title="Re-create silence"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={(e) => { e.stopPropagation(); onExpire(silence) }}
              title="Expire silence"
            >
              <BellMinus className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>by {silence.createdBy}</span>
          <span className="text-muted-foreground/60">•</span>
          <span>{affectedCount} affected alerts</span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="rounded-md border border-border/70 bg-inherit p-2.5">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">Expires</div>
          <SilenceExpiry silence={silence} />
        </div>

        <div className="rounded-md border border-border/70 bg-inherit p-2.5">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">Matchers</div>
          <div className="flex flex-wrap gap-1">
            {visibleMatchers.map((m, i) => (
              <TruncatableChip key={i} className="rounded border px-1.5 py-0.5 font-mono text-xs" style={labelColorStyle(m.name, theme)}>
                {m.name}{matcherOperator(m.isRegex, m.isEqual)}{m.value}
              </TruncatableChip>
            ))}
            {hiddenMatcherCount > 0 && (
              <span className="rounded border border-dashed border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                +{hiddenMatcherCount} more
              </span>
            )}
            {silence.matchers.length === 0 && (
              <span className="text-xs text-muted-foreground">No matchers</span>
            )}
          </div>
        </div>

        {silence.comment && (
          <div className="rounded-md border border-border/70 bg-inherit p-2.5">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">Comment</div>
            <p className="text-xs text-muted-foreground line-clamp-3">{silence.comment}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
