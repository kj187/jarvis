import { formatDistanceToNow } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { Bell, BellOff, RefreshCw, User, X } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { StatusBadge } from './AlertBadge'
import { HIDDEN_LABEL_KEYS, LabelChip } from './LabelChip'
import { useAlertStats } from '@/hooks/useAlerts'
import { useSetClaim, useReleaseClaim } from '@/hooks/useAlertClaim'
import { getSilenceState, formatSilenceDuration } from '@/lib/alertUtils'
import type { EnrichedAlert, Silence } from '@/types'
import { cn } from '@/lib/utils'

const USERNAME_KEY = 'jarvis-username'

interface AlertListRowProps {
  alert: EnrichedAlert
  onClick: (fingerprint: string) => void
  selected: boolean
  indented?: boolean
  isLastInGroup?: boolean
  excludeLabels?: Record<string, string>
  silences?: Silence[]
  onCreateSilence?: (alerts: EnrichedAlert[], prefillSilence?: Silence, isRecreate?: boolean) => void
  onExpireSilence?: (id: string, cluster: string) => void
  showStateColumn?: boolean
}

export function AlertListRow({
  alert,
  onClick,
  selected,
  indented,
  isLastInGroup,
  excludeLabels,
  silences,
  onCreateSilence,
  onExpireSilence,
  showStateColumn = true,
}: AlertListRowProps) {
  const alertname = alert.labels['alertname'] ?? '—'
  const isResolved = alert.status.state === 'resolved'

  const [showNameInput, setShowNameInput] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const setClaimMutation = useSetClaim(alert.fingerprint)
  const releaseMutation = useReleaseClaim(alert.fingerprint)

  useEffect(() => {
    if (showNameInput) nameInputRef.current?.focus()
  }, [showNameInput])

  function handleClaimClick(e: React.MouseEvent) {
    e.stopPropagation()
    const stored = localStorage.getItem(USERNAME_KEY)
    if (stored) {
      setClaimMutation.mutate({ claimedBy: stored })
    } else {
      setNameInput('')
      setShowNameInput(true)
    }
  }

  function handleNameSubmit(e: React.FormEvent) {
    e.preventDefault()
    e.stopPropagation()
    const name = nameInput.trim()
    if (!name) return
    localStorage.setItem(USERNAME_KEY, name)
    setClaimMutation.mutate({ claimedBy: name }, { onSuccess: () => setShowNameInput(false) })
  }

  function handleRelease(e: React.MouseEvent) {
    e.stopPropagation()
    releaseMutation.mutate(localStorage.getItem(USERNAME_KEY) ?? 'unknown')
  }

  const { data: stats } = useAlertStats(alert.fingerprint)

  const { type: silenceType, silence, remaining } = silences
    ? getSilenceState(alert, silences)
    : { type: null as null, silence: null, remaining: undefined }

  const uniqueLabels = Object.entries(alert.labels).filter(
    ([key, value]) =>
      !HIDDEN_LABEL_KEYS.has(key) &&
      !key.startsWith('__') &&
      excludeLabels?.[key] !== value,
  )

  return (
    <tr
      role="row"
      tabIndex={0}
      onClick={() => onClick(alert.fingerprint)}
      onKeyDown={(e) => e.key === 'Enter' && onClick(alert.fingerprint)}
      className={cn(
        'cursor-pointer transition-colors hover:bg-accent/50',
        indented && !selected && !alert.activeClaim && 'bg-background/60',
        alert.activeClaim && !selected && 'bg-blue-950/30 hover:bg-blue-950/50',
        isLastInGroup && 'border-b border-border/60',
        isResolved && 'opacity-50',
        selected && 'bg-accent',
      )}
    >
      <td className={cn('px-4 py-2 border-l-2', indented && 'pl-10', alert.activeClaim ? 'border-blue-600/70' : 'border-transparent')}>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{alertname}</span>
          {alert.annotations['description'] && (
            <span className="text-xs text-muted-foreground">{alert.annotations['description']}</span>
          )}
          <div className="flex flex-wrap gap-1 pt-0.5">
            <LabelChip labelKey="@cluster" value={alert.clusterName} />
            {uniqueLabels.map(([key, value]) => (
              <LabelChip key={key} labelKey={key} value={value} />
            ))}
          </div>
        </div>
      </td>
      {showStateColumn && (
        <td className="px-4 py-2">
          <StatusBadge state={alert.status.state} />
        </td>
      )}
      <td className="px-4 py-2 text-sm text-muted-foreground">
        <div className="flex flex-col gap-0.5">
          <span title={new Date(alert.startsAt).toLocaleString('en-US')}>
            {formatDistanceToNow(new Date(alert.startsAt), { addSuffix: true, locale: enUS })}
          </span>
          {isResolved && stats?.lastResolvedAt && (
            <span className="text-xs text-green-600/70" title={new Date(stats.lastResolvedAt).toLocaleString('en-US')}>
              ✓ {formatDistanceToNow(new Date(stats.lastResolvedAt), { addSuffix: true, locale: enUS })}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-1.5">
          {stats && stats.occurrenceCount > 1 && (
            <span
              className="text-xs text-muted-foreground"
              title={`${stats.occurrenceCount}× occurred`}
            >
              ↻{stats.occurrenceCount}×
            </span>
          )}
          {silenceType === 'active' && silence && remaining !== undefined && (
            <>
              <span
                className="flex items-center gap-1 text-xs text-slate-400"
                title={`Silence active, ends in ${formatSilenceDuration(remaining)}`}
              >
                <BellOff className="h-3 w-3" />
                {formatSilenceDuration(remaining)}
              </span>
              <button
                type="button"
                onClick={() => onExpireSilence?.(silence.id, silence.clusterName)}
                title="Expire silence"
                className="cursor-pointer rounded p-0.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
              >
                <X className="h-3 w-3" />
              </button>
            </>
          )}
          {silenceType === 'expiring' && silence && remaining !== undefined && (
            <>
              <span
                className="flex items-center gap-1 text-xs text-yellow-400"
                title={`Silence expires in ${formatSilenceDuration(remaining)}`}
              >
                <BellOff className="h-3 w-3" />
                {formatSilenceDuration(remaining)}
              </span>
              <button
                type="button"
                onClick={() => onCreateSilence?.([alert], silence, true)}
                title="Extend silence"
                className="cursor-pointer rounded p-0.5 text-yellow-400 hover:bg-yellow-900/40"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            </>
          )}
          {silenceType === 'pending' && (
            <span className="flex items-center gap-1 text-xs text-slate-400">
              <BellOff className="h-3 w-3" />
              pending
            </span>
          )}
          {silenceType === null && (
            <button
              type="button"
              onClick={() => onCreateSilence?.([alert])}
              title="Create silence"
              className="cursor-pointer text-muted-foreground/40 transition-colors hover:text-foreground"
            >
              <Bell className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </td>
      <td className="px-4 py-2 text-sm" onClick={(e) => e.stopPropagation()}>
        {alert.activeClaim ? (
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 text-blue-400">
              <User className="h-3 w-3" />
              {alert.activeClaim.claimedBy}
            </span>
            <button
              type="button"
              onClick={handleRelease}
              title="Release claim"
              className="cursor-pointer rounded p-0.5 text-muted-foreground/50 hover:text-foreground"
              disabled={releaseMutation.isPending}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : showNameInput ? (
          <form onSubmit={handleNameSubmit} className="flex items-center gap-1">
            <input
              ref={nameInputRef}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Your name"
              className="h-6 w-24 rounded border border-border bg-background px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              onKeyDown={(e) => e.key === 'Escape' && setShowNameInput(false)}
            />
            <button
              type="submit"
              disabled={!nameInput.trim() || setClaimMutation.isPending}
              className="cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <User className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => setShowNameInput(false)}
              className="cursor-pointer rounded p-0.5 text-muted-foreground/50 hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={handleClaimClick}
            title="I'll take this"
            className="cursor-pointer text-muted-foreground/40 transition-colors hover:text-blue-400"
            disabled={setClaimMutation.isPending}
          >
            <User className="h-3.5 w-3.5" />
          </button>
        )}
      </td>
    </tr>
  )
}
