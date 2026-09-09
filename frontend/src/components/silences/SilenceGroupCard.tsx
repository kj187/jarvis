import { BellMinus, Layers3, Loader2, RotateCcw } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SilenceLifetimeBar } from './SilenceLifetimeBar'
import { SilenceMatcherChip } from './SilenceMatcherChip'
import { silenceTiming } from '@/lib/alertUtils'
import { URGENCY_FILL_CLASS } from './silenceDisplay'
import { useSettingsStore } from '@/store/useSettingsStore'
import type { EnrichedAlert, Silence } from '@/types'
import { cn } from '@/lib/utils'

export interface SilenceGroup {
  key: string
  silences: Silence[]
}

interface SilenceGroupCardProps {
  group: SilenceGroup
  alerts: EnrichedAlert[]
  onEditGroup: (silences: Silence[]) => void
  onExpireGroup: (silences: Silence[]) => void
  deletingIds: Set<string>
}

export function SilenceGroupCard({ group, alerts, onEditGroup, onExpireGroup, deletingIds }: SilenceGroupCardProps) {
  const theme = useSettingsStore((s) => s.theme)
  const rep = group.silences[0]
  const isDeleting = group.silences.some((s) => deletingIds.has(s.id))
  const allExpired = group.silences.every((s) => s.status.state === 'expired')
  const allSameState = group.silences.every((s) => s.status.state === rep.status.state)
  const silenceIds = new Set(group.silences.map((s) => s.id))
  const uniqueClusters = Array.from(new Set(group.silences.map((s) => s.clusterName)))
  const stateCounts = group.silences.reduce(
    (acc, silence) => {
      acc[silence.status.state] += 1
      return acc
    },
    { active: 0, pending: 0, expired: 0 },
  )
  const totalAffected = alerts.reduce(
    (sum, alert) => sum + (alert.status.silencedBy.some((id) => silenceIds.has(id)) ? 1 : 0),
    0,
  )
  const { urgency } = silenceTiming(rep)
  const visibleMatchers = rep.matchers.slice(0, 4)
  const hiddenMatcherCount = Math.max(0, rep.matchers.length - visibleMatchers.length)

  return (
    <Card
      className={cn(
        'group relative flex flex-col overflow-hidden border-border/40 bg-card/70 p-0 transition-all cursor-pointer hover:border-border hover:bg-muted/30 hover:shadow-md',
        allExpired && 'opacity-75 hover:opacity-100',
        isDeleting && 'opacity-50',
      )}
      onClick={() => onEditGroup(group.silences)}
      title={allExpired ? 'Expired — click to re-create' : 'Edit silences'}
      data-testid="silence-group-card"
    >
      {isDeleting && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      <div className="flex flex-1 flex-col gap-2.5 p-3.5">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', URGENCY_FILL_CLASS[urgency])} />
          <span className="inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold">
            <Layers3 className="h-3 w-3" />
            {group.silences.length} silences
          </span>
          {allSameState ? (
            <span className="text-xs font-semibold capitalize">{rep.status.state}</span>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {[
                stateCounts.active > 0 ? `${stateCounts.active} active` : null,
                stateCounts.pending > 0 ? `${stateCounts.pending} pending` : null,
                stateCounts.expired > 0 ? `${stateCounts.expired} expired` : null,
              ].filter((x): x is string => x !== null).join(' · ')}
            </span>
          )}
          {allExpired ? (
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-6 w-6 shrink-0 text-muted-foreground"
              onClick={(e) => { e.stopPropagation(); onEditGroup(group.silences) }}
              title={`Re-create ${group.silences.length} silences`}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-6 w-6 shrink-0 text-muted-foreground"
              onClick={(e) => { e.stopPropagation(); onExpireGroup(group.silences) }}
              title={`Expire ${group.silences.length} silences`}
            >
              <BellMinus className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <div className="truncate text-[11px] text-muted-foreground/70">
          by {rep.createdBy}
          <span className="mx-1 text-muted-foreground/40">·</span>
          {totalAffected} affected alert{totalAffected === 1 ? '' : 's'}
        </div>

        <div className="flex flex-wrap gap-1">
          {uniqueClusters.map((cluster) => (
            <span key={cluster} className="rounded bg-accent px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {cluster}
            </span>
          ))}
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
          {rep.matchers.length === 0 && (
            <span className="text-xs text-muted-foreground">No matchers</span>
          )}
        </div>

        {rep.comment && (
          <p className="line-clamp-2 border-l-2 border-border pl-2 text-xs italic text-muted-foreground">
            {rep.comment}
          </p>
        )}
      </div>

      <SilenceLifetimeBar silence={rep} />
    </Card>
  )
}
