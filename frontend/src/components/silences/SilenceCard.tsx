import { BellMinus, Loader2, RotateCcw } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SilenceLifetimeBar } from './SilenceLifetimeBar'
import { SilenceMatcherChip } from './SilenceMatcherChip'
import { silenceTiming } from '@/lib/alertUtils'
import { URGENCY_FILL_CLASS } from './silenceDisplay'
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

export function SilenceCard({ silence, alerts, onEdit, onExpire, isDeleting = false }: SilenceCardProps) {
  const theme = useSettingsStore((s) => s.theme)
  const affectedCount = alerts.reduce(
    (sum, alert) => sum + (alert.status.silencedBy.includes(silence.id) ? 1 : 0),
    0,
  )

  const isExpired = silence.status.state === 'expired'
  const { urgency } = silenceTiming(silence)
  const visibleMatchers = silence.matchers.slice(0, 4)
  const hiddenMatcherCount = Math.max(0, silence.matchers.length - visibleMatchers.length)

  return (
    <Card
      className={cn(
        'group relative flex flex-col overflow-hidden border-border/40 bg-card/70 p-0 transition-all cursor-pointer hover:border-border hover:bg-muted/30 hover:shadow-md',
        isExpired && 'opacity-75 hover:opacity-100',
        isDeleting && 'opacity-50',
      )}
      onClick={() => onEdit(silence)}
      title={isExpired ? 'Expired — click to re-create' : 'Edit silence'}
      data-testid="silence-card"
    >
      {isDeleting && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      <div className="flex flex-1 flex-col gap-2.5 p-3.5">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', URGENCY_FILL_CLASS[urgency])} />
          <span className="text-xs font-semibold capitalize">{silence.status.state}</span>
          <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {silence.clusterName}
          </span>
          {isExpired ? (
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-6 w-6 shrink-0 text-muted-foreground"
              onClick={(e) => { e.stopPropagation(); onEdit(silence) }}
              title="Re-create silence"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-6 w-6 shrink-0 text-muted-foreground"
              onClick={(e) => { e.stopPropagation(); onExpire(silence) }}
              title="Expire silence"
            >
              <BellMinus className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <div className="truncate text-[11px] text-muted-foreground/70">
          by {silence.createdBy}
          <span className="mx-1 text-muted-foreground/40">·</span>
          {affectedCount} affected alert{affectedCount === 1 ? '' : 's'}
        </div>

        <div className="flex flex-wrap gap-x-2.5 gap-y-1">
          {visibleMatchers.map((m, i) => (
            <SilenceMatcherChip key={i} matcher={m} theme={theme} />
          ))}
          {hiddenMatcherCount > 0 && (
            <span className="self-center font-mono text-[11px] text-muted-foreground/60">
              +{hiddenMatcherCount} more
            </span>
          )}
          {silence.matchers.length === 0 && (
            <span className="text-xs text-muted-foreground">No matchers</span>
          )}
        </div>

        {silence.comment && (
          <p className="line-clamp-2 border-l-2 border-border pl-2 text-xs italic text-muted-foreground">
            {silence.comment}
          </p>
        )}
      </div>

      <SilenceLifetimeBar silence={silence} />
    </Card>
  )
}
