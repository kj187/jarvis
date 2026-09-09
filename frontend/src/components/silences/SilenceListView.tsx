import { BellMinus, Loader2, RotateCcw } from 'lucide-react'
import { format } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { SilenceMatcherChip } from './SilenceMatcherChip'
import { SilenceRemaining } from './SilenceRemaining'
import { URGENCY_FILL_CLASS } from './silenceDisplay'
import { silenceTiming, tzAbbr } from '@/lib/alertUtils'
import { useSettingsStore } from '@/store/useSettingsStore'
import type { Silence, EnrichedAlert } from '@/types'
import { cn } from '@/lib/utils'
import type { SilenceGroup } from './SilenceGroupCard'

interface SilenceListViewProps {
  groups: SilenceGroup[]
  alerts: EnrichedAlert[]
  onEditGroup: (silences: Silence[]) => void
  onExpireGroup: (silences: Silence[]) => void
  deletingIds: Set<string>
}

const ROW_DATE_FMT = 'MMM d, HH:mm'

export function SilenceListView({ groups, alerts, onEditGroup, onExpireGroup, deletingIds }: SilenceListViewProps) {
  const theme = useSettingsStore((s) => s.theme)

  if (groups.length === 0) return null

  return (
    <div className="overflow-hidden rounded-md border border-border">
      {groups.map((group) => {
        const rep = group.silences[0]
        const isDeleting = group.silences.some((s) => deletingIds.has(s.id))
        const allExpired = group.silences.every((s) => s.status.state === 'expired')
        const allSameState = group.silences.every((s) => s.status.state === rep.status.state)
        const silenceIds = new Set(group.silences.map((s) => s.id))
        const uniqueClusters = Array.from(new Set(group.silences.map((s) => s.clusterName)))
        const totalAffected = alerts.reduce(
          (sum, alert) => sum + (alert.status.silencedBy.some((id) => silenceIds.has(id)) ? 1 : 0),
          0,
        )
        const { urgency } = silenceTiming(rep)
        const visibleMatchers = rep.matchers.slice(0, 6)
        const hiddenMatcherCount = Math.max(0, rep.matchers.length - visibleMatchers.length)
        const stateCounts = group.silences.reduce(
          (acc, silence) => {
            acc[silence.status.state] += 1
            return acc
          },
          { active: 0, pending: 0, expired: 0 },
        )
        const stateLabel = allSameState
          ? rep.status.state
          : [
              stateCounts.active > 0 ? `${stateCounts.active} active` : null,
              stateCounts.pending > 0 ? `${stateCounts.pending} pending` : null,
              stateCounts.expired > 0 ? `${stateCounts.expired} expired` : null,
            ].filter((x): x is string => x !== null).join(' · ')

        const groupCount = group.silences.length

        const meta = [
          stateLabel,
          uniqueClusters.join(', '),
          `by ${rep.createdBy}`,
          `${totalAffected} alert${totalAffected === 1 ? '' : 's'}`,
          `created ${format(new Date(rep.updatedAt), ROW_DATE_FMT, { locale: enUS })} ${tzAbbr}`,
          groupCount > 1 ? `${groupCount} silences` : null,
        ].filter(Boolean).join('  ·  ')

        return (
          <div
            key={group.key}
            className={cn(
              'group relative grid cursor-pointer grid-cols-[3px_minmax(0,1fr)_auto] items-stretch gap-x-3 border-b border-border/60 bg-card/70 pr-2 text-xs transition-colors last:border-b-0 hover:bg-muted/30',
              allExpired && 'opacity-70',
              isDeleting && 'opacity-50',
            )}
            onClick={() => onEditGroup(group.silences)}
          >
            {isDeleting && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}

            <div className={cn('w-[3px]', URGENCY_FILL_CLASS[urgency])} />

            <div className="min-w-0 py-2">
              <div className="flex gap-x-3 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(90deg,#000_82%,transparent)]">
                {visibleMatchers.map((m, i) => (
                  <SilenceMatcherChip key={i} matcher={m} theme={theme} />
                ))}
                {hiddenMatcherCount > 0 && (
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground/60">+{hiddenMatcherCount}</span>
                )}
                {rep.matchers.length === 0 && (
                  <span className="font-mono text-[11px] text-muted-foreground/60">no matchers</span>
                )}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{meta}</div>
              {rep.comment && (
                <div className="truncate text-[11px] italic text-muted-foreground/60">{rep.comment}</div>
              )}
            </div>

            <div className="flex items-center gap-2 py-2">
              <div className="text-right leading-tight">
                <SilenceRemaining silence={rep} className="block text-[13px]" />
                <span className="text-[10.5px] tabular-nums text-muted-foreground/60">
                  {format(new Date(rep.endsAt), ROW_DATE_FMT, { locale: enUS })}
                </span>
              </div>
              {allExpired ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground"
                  onClick={(e) => { e.stopPropagation(); onEditGroup(group.silences) }}
                  title={groupCount > 1 ? `Re-create ${groupCount} silences` : 'Re-create silence'}
                >
                  <RotateCcw className="h-3 w-3" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground"
                  onClick={(e) => { e.stopPropagation(); onExpireGroup(group.silences) }}
                  title={groupCount > 1 ? `Expire ${groupCount} silences` : 'Expire silence'}
                >
                  <BellMinus className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
