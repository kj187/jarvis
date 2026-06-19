import { format } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { BellMinus, Loader2 } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { tzAbbr } from '@/lib/alertUtils'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/store/useSettingsStore'
import type { Silence, EnrichedAlert } from '@/types'

interface SilenceExpireModalProps {
  silences: Silence[]
  allAlerts?: EnrichedAlert[]
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
}

function MatcherChip({ matcher }: { matcher: Silence['matchers'][number] }) {
  const op = matcher.isRegex
    ? matcher.isEqual ? '=~' : '!~'
    : matcher.isEqual ? '=' : '!='
  return (
    <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-xs">
      {matcher.name}{op}{matcher.value}
    </span>
  )
}

function SilenceDetail({ silence, allAlerts }: { silence: Silence; allAlerts?: EnrichedAlert[] }) {
  const theme = useSettingsStore((s) => s.theme)
  const isPending = silence.status.state === 'pending'
  const now = Date.now()
  const remaining = new Date(silence.endsAt).getTime() - now

  const affected = allAlerts?.filter((a) => a.status.silencedBy.includes(silence.id)) ?? []

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="rounded bg-accent px-2 py-0.5 text-xs">{silence.clusterName}</span>
        <span className={cn(
          'rounded px-2 py-0.5 text-xs font-semibold',
          silence.status.state === 'active' && (theme === 'light' ? 'bg-green-100 text-green-700' : 'bg-green-900/40 text-green-400'),
          silence.status.state === 'pending' && (theme === 'light' ? 'bg-slate-200 text-slate-600' : 'bg-slate-800 text-slate-300'),
          silence.status.state === 'expired' && (theme === 'light' ? 'bg-slate-100 text-slate-500' : 'bg-slate-900 text-slate-500'),
        )}>
          {silence.status.state}
        </span>
      </div>

      <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-foreground">Silence ID</span>
        <a
          href={`${silence.alertmanagerUrl}/#/silences/${silence.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-muted-foreground truncate hover:text-foreground underline decoration-dotted"
          onClick={(e) => e.stopPropagation()}
        >
          {silence.id}
        </a>

        <span className="text-muted-foreground">Created by</span>
        <span>{silence.createdBy}</span>

        <span className="text-muted-foreground">Created at</span>
        <span className="text-muted-foreground">
          {format(new Date(silence.updatedAt), 'yyyy-MM-dd HH:mm', { locale: enUS })} {tzAbbr}
        </span>

        {isPending ? (
          <>
            <span className="text-muted-foreground">Starts at</span>
            <span className="text-muted-foreground">
              {format(new Date(silence.startsAt), 'yyyy-MM-dd HH:mm', { locale: enUS })} {tzAbbr}
            </span>
          </>
        ) : (
          <>
            <span className="text-muted-foreground">
              {silence.status.state === 'active' && remaining <= 15 * 60_000 ? 'Expires' : 'Ends'}
            </span>
            <span className="text-muted-foreground">
              {format(new Date(silence.endsAt), 'yyyy-MM-dd HH:mm', { locale: enUS })} {tzAbbr}
            </span>
          </>
        )}

        {silence.comment && (
          <>
            <span className="text-muted-foreground">Reason</span>
            <span className="text-muted-foreground">{silence.comment}</span>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {silence.matchers.map((m, i) => <MatcherChip key={i} matcher={m} />)}
      </div>

      {affected.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Affected Alerts ({affected.length})
          </p>
          <div className="space-y-0.5">
            {affected.map((a) => (
              <div key={a.fingerprint} className="flex items-center gap-2 text-xs">
                <span className="font-medium text-foreground">{a.labels['alertname'] ?? a.fingerprint}</span>
                {a.labels['instance'] && (
                  <span className="text-muted-foreground">{a.labels['instance']}</span>
                )}
                {a.labels['job'] && !a.labels['instance'] && (
                  <span className="text-muted-foreground">{a.labels['job']}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function SilenceExpireModal({ silences, allAlerts, open, onConfirm, onCancel, isPending }: SilenceExpireModalProps) {
  const count = silences.length
  const title = count === 1 ? 'Expire silence?' : `Expire ${count} silences?`

  return (
    <Dialog open={open} onClose={onCancel}>
      <div className="p-6 space-y-4">
        <div className="space-y-1 pr-6">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <BellMinus className="h-4 w-4 text-muted-foreground shrink-0" />
            {title}
          </h2>
          <p className="text-xs text-muted-foreground">
            This will immediately expire {count === 1 ? 'the silence' : 'all selected silences'} in Alertmanager.
          </p>
        </div>

        <div className="space-y-4">
          {silences.map((s, i) => (
            <div key={s.id}>
              {count > 1 && i > 0 && <div className="border-t border-border mt-4 mb-4" />}
              <SilenceDetail silence={s} allAlerts={allAlerts} />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm} disabled={isPending}>
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            {isPending ? 'Expiring…' : count === 1 ? 'Expire silence' : `Expire ${count} silences`}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
