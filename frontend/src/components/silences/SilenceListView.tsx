import { BellMinus, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SilenceExpiry } from './SilenceExpiry'
import { labelColorStyle } from '@/lib/alertUtils'
import { useSettingsStore } from '@/store/useSettingsStore'
import { TruncatableChip } from '@/components/ui/truncatable-chip'
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

function stateBadgeClass(state: string, theme: string): string {
  if (state === 'active') return theme === 'light' ? 'bg-green-100 text-green-700' : 'bg-green-900/40 text-green-400'
  if (state === 'pending') return theme === 'light' ? 'bg-slate-200 text-slate-600' : 'bg-slate-800 text-slate-300'
  return theme === 'light' ? 'bg-slate-100 text-slate-500' : 'bg-slate-900 text-slate-500'
}

function matcherOperator(isRegex: boolean, isEqual: boolean): string {
  if (isRegex) return isEqual ? '=~' : '!~'
  return isEqual ? '=' : '!='
}

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
        const visibleMatchers = rep.matchers.slice(0, 3)
        const hiddenMatcherCount = Math.max(0, rep.matchers.length - visibleMatchers.length)
        const visibleClusters = uniqueClusters.slice(0, 2)
        const hiddenClusterCount = Math.max(0, uniqueClusters.length - visibleClusters.length)
        const stateCounts = group.silences.reduce(
          (acc, silence) => {
            acc[silence.status.state] += 1
            return acc
          },
          { active: 0, pending: 0, expired: 0 },
        )

        return (
          <div
            key={group.key}
            className={cn(
              'relative cursor-pointer border-b border-border/70 bg-card/70 px-3 py-2 text-xs transition-colors last:border-b-0 hover:bg-muted/30',
              allExpired && 'opacity-75',
              isDeleting && 'opacity-50',
            )}
            onClick={() => onEditGroup(group.silences)}
          >
            {isDeleting && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_170px_70px_34px] md:items-center md:gap-3">
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  {allSameState ? (
                    <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold', stateBadgeClass(rep.status.state, theme))}>
                      {rep.status.state}
                    </span>
                  ) : (
                    <>
                      {stateCounts.active > 0 && (
                        <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold', stateBadgeClass('active', theme))}>
                          a {stateCounts.active}
                        </span>
                      )}
                      {stateCounts.pending > 0 && (
                        <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold', stateBadgeClass('pending', theme))}>
                          p {stateCounts.pending}
                        </span>
                      )}
                      {stateCounts.expired > 0 && (
                        <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold', stateBadgeClass('expired', theme))}>
                          e {stateCounts.expired}
                        </span>
                      )}
                    </>
                  )}
                  {visibleClusters.map((cluster) => (
                    <span key={cluster} className="rounded bg-accent px-1.5 py-0.5 text-xs">
                      {cluster}
                    </span>
                  ))}
                  {hiddenClusterCount > 0 && (
                    <span className="rounded border border-dashed border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                      +{hiddenClusterCount}
                    </span>
                  )}
                  <span className="text-muted-foreground/60">•</span>
                  <span className="truncate text-muted-foreground/80">by {rep.createdBy}</span>
                </div>

                <div className="mb-1 flex flex-wrap items-center gap-1">
                  {visibleMatchers.map((m, i) => (
                    <TruncatableChip key={i} className="rounded border px-1.5 py-0.5 font-mono text-xs" style={labelColorStyle(m.name, theme)}>
                      {m.name}{matcherOperator(m.isRegex, m.isEqual)}{m.value}
                    </TruncatableChip>
                  ))}
                  {hiddenMatcherCount > 0 && (
                    <span className="rounded border border-dashed border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                      +{hiddenMatcherCount}
                    </span>
                  )}
                </div>

                {rep.comment && <div className="truncate text-xs text-muted-foreground">{rep.comment}</div>}
              </div>

              <div className="text-xs text-muted-foreground md:text-right">
                <SilenceExpiry silence={rep} />
              </div>

              <div className="text-xs text-muted-foreground md:text-right">
                {totalAffected}
              </div>

              <div className="flex md:justify-end">
                {allExpired ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={(e) => { e.stopPropagation(); onEditGroup(group.silences) }}
                    title={group.silences.length > 1 ? `Re-create ${group.silences.length} silences` : 'Re-create silence'}
                  >
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={(e) => { e.stopPropagation(); onExpireGroup(group.silences) }}
                    title={group.silences.length > 1 ? `Expire ${group.silences.length} silences` : 'Expire silence'}
                  >
                    <BellMinus className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
