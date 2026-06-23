import { BellMinus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SilenceExpiry } from './SilenceExpiry'
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

function stateBadgeClass(state: string, theme: string): string {
  if (state === 'active') return theme === 'light' ? 'bg-green-100 text-green-700' : 'bg-green-900/40 text-green-400'
  if (state === 'pending') return theme === 'light' ? 'bg-slate-200 text-slate-600' : 'bg-slate-800 text-slate-300'
  return theme === 'light' ? 'bg-slate-100 text-slate-500' : 'bg-slate-900 text-slate-500'
}

export function SilenceListView({ groups, alerts, onEditGroup, onExpireGroup, deletingIds }: SilenceListViewProps) {
  const theme = useSettingsStore((s) => s.theme)

  if (groups.length === 0) return null

  return (
    <div className="rounded-md border border-border overflow-hidden">
      {/* Header */}
      <div className="hidden md:grid grid-cols-[1fr_160px_80px_40px] gap-3 px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border bg-accent/30">
        <span>Matchers / Clusters / Comment</span>
        <span>Expiry</span>
        <span className="text-right">Affected</span>
        <span />
      </div>

      {groups.map((group) => {
        const rep = group.silences[0]
        const isDeleting = group.silences.some((s) => deletingIds.has(s.id))
        const allExpired = group.silences.every((s) => s.status.state === 'expired')
        const allSameState = group.silences.every((s) => s.status.state === rep.status.state)
        const totalAffected = group.silences.reduce(
          (sum, s) => sum + alerts.filter((a) => a.status.silencedBy.includes(s.id)).length,
          0,
        )

        return (
          <div
            key={group.key}
            className={cn(
              'grid grid-cols-1 md:grid-cols-[1fr_160px_80px_40px] gap-x-3 gap-y-1 px-3 py-2.5 border-b border-border last:border-0 text-xs transition-colors relative',
              allExpired && 'opacity-60',
              isDeleting && 'opacity-50',
              !allExpired && 'cursor-pointer hover:bg-muted/50',
            )}
            onClick={!allExpired ? () => onEditGroup(group.silences) : undefined}
          >
            {isDeleting && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Matchers + clusters + comment + creator */}
            <div className="flex flex-col gap-1.5 min-w-0">
              <div className="flex flex-wrap gap-1">
                {rep.matchers.map((m, i) => (
                  <span key={i} className="rounded bg-accent px-1.5 py-0.5 font-mono text-xs">
                    {m.name}{m.isRegex ? (m.isEqual ? '=~' : '!~') : m.isEqual ? '=' : '!='}{m.value}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {allSameState && (
                  <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold', stateBadgeClass(rep.status.state, theme))}>
                    {rep.status.state}
                  </span>
                )}
                {group.silences.map((s) => (
                  <div key={s.id} className="flex items-center gap-1">
                    <span className="rounded bg-accent px-1.5 py-0.5 text-xs">{s.clusterName}</span>
                    {!allSameState && (
                      <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold', stateBadgeClass(s.status.state, theme))}>
                        {s.status.state}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {rep.comment && (
                <span className="text-muted-foreground truncate" title={rep.comment}>{rep.comment}</span>
              )}
              <span className="text-muted-foreground/60">by {rep.createdBy}</span>
            </div>

            {/* Expiry */}
            <div className="flex items-center">
              <span className="whitespace-nowrap">
                <SilenceExpiry silence={rep} />
              </span>
            </div>

            {/* Affected */}
            <div className="flex items-center md:justify-end">
              <span className="text-muted-foreground">
                <span className="md:hidden text-muted-foreground/60 mr-1">Affected:</span>
                {totalAffected}
              </span>
            </div>

            {/* Actions */}
            <div className="flex items-center md:justify-end">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => { e.stopPropagation(); onExpireGroup(group.silences) }}
                title={group.silences.length > 1 ? `Expire ${group.silences.length} silences` : 'Expire silence'}
              >
                <BellMinus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
