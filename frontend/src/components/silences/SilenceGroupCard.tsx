import { BellMinus, Loader2, RotateCcw } from 'lucide-react'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SilenceExpiry } from './SilenceExpiry'
import { labelColorStyle } from '@/components/alerts/LabelChip'
import { useSettingsStore } from '@/store/useSettingsStore'
import type { Silence, EnrichedAlert } from '@/types'
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

function stateBadgeClass(state: string, theme: string): string {
  if (state === 'active') return theme === 'light' ? 'bg-green-100 text-green-700' : 'bg-green-900/40 text-green-400'
  if (state === 'pending') return theme === 'light' ? 'bg-slate-200 text-slate-600' : 'bg-slate-800 text-slate-300'
  return theme === 'light' ? 'bg-slate-100 text-slate-500' : 'bg-slate-900 text-slate-500'
}

export function SilenceGroupCard({ group, alerts, onEditGroup, onExpireGroup, deletingIds }: SilenceGroupCardProps) {
  const theme = useSettingsStore((s) => s.theme)
  const rep = group.silences[0]
  const isDeleting = group.silences.some((s) => deletingIds.has(s.id))
  const allExpired = group.silences.every((s) => s.status.state === 'expired')
  const allSameState = group.silences.every((s) => s.status.state === rep.status.state)

  const totalAffected = group.silences.reduce(
    (sum, s) => sum + alerts.filter((a) => a.status.silencedBy.includes(s.id)).length,
    0,
  )

  return (
    <Card
      className={cn(
        'relative border-border/40 transition-colors cursor-pointer hover:bg-muted/50',
        allExpired && 'opacity-60 hover:opacity-100',
        isDeleting && 'opacity-50',
      )}
      onClick={() => onEditGroup(group.silences)}
      title={allExpired ? 'Expired — click to re-create' : 'Edit silences'}
    >
      {isDeleting && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/60">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Status badge — top-right */}
      {allSameState && (
        <span className={cn('absolute top-2 right-2 rounded px-2 py-0.5 text-xs font-semibold', stateBadgeClass(rep.status.state, theme))}>
          {rep.status.state}
        </span>
      )}

      <CardHeader className="pb-2 pr-20">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {group.silences.map((s) => (
              <div key={s.id} className="flex items-center gap-1">
                <span className="rounded bg-accent px-2 py-0.5 text-xs">{s.clusterName}</span>
                {!allSameState && (
                  <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold', stateBadgeClass(s.status.state, theme))}>
                    {s.status.state}
                  </span>
                )}
              </div>
            ))}
          </div>
          <SilenceExpiry silence={rep} />
        </div>
      </CardHeader>

      <CardContent className="space-y-2 pb-10">
        <div className="flex flex-wrap gap-1">
          {rep.matchers.map((m, i) => (
            <span key={i} className="rounded border px-1.5 py-0.5 font-mono text-xs" style={labelColorStyle(m.name, theme)}>
              {m.name}{m.isRegex ? (m.isEqual ? '=~' : '!~') : m.isEqual ? '=' : '!='}{m.value}
            </span>
          ))}
        </div>

        {rep.comment && (
          <p className="text-xs text-muted-foreground line-clamp-2">{rep.comment}</p>
        )}

      </CardContent>

      {/* Bottom-left badges */}
      <div className="absolute bottom-3 left-4 flex gap-1">
        <span className="rounded bg-accent px-1.5 py-0.5 text-xs text-muted-foreground">
          by {rep.createdBy}
        </span>
        <span className="rounded bg-accent px-1.5 py-0.5 text-xs text-muted-foreground">
          Affected: {totalAffected}
        </span>
      </div>

      {/* Action button — bottom-right */}
      {allExpired ? (
        <Button
          variant="ghost"
          size="icon"
          className="absolute bottom-2 right-2 h-7 w-7"
          onClick={(e) => { e.stopPropagation(); onEditGroup(group.silences) }}
          title={`Re-create ${group.silences.length} silences`}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="absolute bottom-2 right-2 h-7 w-7"
          onClick={(e) => { e.stopPropagation(); onExpireGroup(group.silences) }}
          title={`Expire ${group.silences.length} silences`}
        >
          <BellMinus className="h-3.5 w-3.5" />
        </Button>
      )}
    </Card>
  )
}
