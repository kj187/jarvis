import { Bell, BellMinus, BellOff, RefreshCw, User, X } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { AlertBadge, StatusBadge } from './AlertBadge'
import { HIDDEN_LABEL_KEYS, LabelChip } from './LabelChip'
import { useAlertStats } from '@/hooks/useAlerts'
import { useSetClaim, useReleaseClaim } from '@/hooks/useAlertClaim'
import { getSilenceState, formatSilenceDuration } from '@/lib/alertUtils'
import { renderTextWithLinks } from '@/lib/linkUtils'
import { useFormatTime } from '@/hooks/useFormatTime'
import type { EnrichedAlert, Silence } from '@/types'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useSettingsStore } from '@/store/useSettingsStore'

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
  onExpireSilence?: (silence: Silence) => void
  showStateColumn?: boolean
  showSeverityColumn?: boolean
  showActionsColumn?: boolean
  showClaimColumn?: boolean
  noOpacity?: boolean
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
  showSeverityColumn = false,
  showActionsColumn = true,
  showClaimColumn = true,
  noOpacity = false,
}: AlertListRowProps) {
  const alertname = alert.labels['alertname'] ?? '—'
  const isResolved = alert.status.state === 'resolved'
  const theme = useSettingsStore((s) => s.theme)

  const [showNameInput, setShowNameInput] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const setClaimMutation = useSetClaim(alert.fingerprint)
  const releaseMutation = useReleaseClaim(alert.fingerprint)
  const { user, providerInfo } = useAuthStore()
  const authMode = providerInfo?.mode ?? 'none'

  useEffect(() => {
    if (showNameInput) nameInputRef.current?.focus()
  }, [showNameInput])

  function handleClaimClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (authMode !== 'none') {
      if (user) {
        setClaimMutation.mutate({ claimedBy: user.username })
      }
      // not logged in: do nothing (button will show tooltip)
      return
    }
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
    releaseMutation.mutate(user?.username ?? localStorage.getItem(USERNAME_KEY) ?? 'unknown')
  }

  const { data: stats } = useAlertStats(alert.fingerprint)
  const formatTime = useFormatTime()

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
      data-testid="alert-list-row"
      onClick={() => onClick(alert.fingerprint)}
      onKeyDown={(e) => e.key === 'Enter' && onClick(alert.fingerprint)}
      className={cn(
        'cursor-pointer transition-colors hover:bg-accent/50',
        indented && !selected && !alert.activeClaim && (theme === 'light' ? 'bg-background' : 'bg-background/60'),
        alert.activeClaim && !selected && (theme === 'light' ? 'bg-blue-50 hover:bg-blue-100/80' : 'bg-blue-950/30 hover:bg-blue-950/50'),
        isLastInGroup && 'border-b border-border/60',
        isResolved && !noOpacity && 'opacity-50',
        selected && 'bg-accent',
      )}
    >
      <td className={cn('px-4 py-2 border-l-2', indented && 'pl-10', alert.activeClaim ? 'border-blue-600/70' : 'border-transparent')}>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">
            {alertname}
            <span className="font-normal text-muted-foreground">, </span>
            <span
              className="text-xs font-normal text-muted-foreground tabular-nums"
              title={new Date(isResolved ? alert.endsAt : alert.startsAt).toLocaleString('en-US')}
            >
              {isResolved ? formatTime(alert.endsAt) : formatTime(alert.startsAt)}
            </span>
            {stats && stats.occurrenceCount > 1 && (
              <>
                <span className="font-normal text-muted-foreground">, </span>
                <span className="text-xs font-normal text-muted-foreground" title={`${stats.occurrenceCount}× occurred`}>
                  ↻{stats.occurrenceCount}×
                </span>
              </>
            )}
            {silenceType === 'active' && silence && remaining !== undefined && (
              <>
                <span className="font-normal text-muted-foreground">, </span>
                <span className="text-xs font-normal text-muted-foreground" title={`Silenced, ends in ${formatSilenceDuration(remaining)}`}>
                  <BellOff className="inline h-3 w-3 align-text-bottom" />
                  {' '}{formatSilenceDuration(remaining)}
                </span>
              </>
            )}
            {silenceType === 'expiring' && silence && remaining !== undefined && (
              <>
                <span className="font-normal text-muted-foreground">, </span>
                <span className={cn('text-xs font-normal', theme === 'light' ? 'text-amber-600' : 'text-yellow-400')} title={`Silence expires in ${formatSilenceDuration(remaining)}`}>
                  <BellOff className="inline h-3 w-3 align-text-bottom" />
                  {' '}{formatSilenceDuration(remaining)}
                </span>
              </>
            )}
            {silenceType === 'pending' && (
              <>
                <span className="font-normal text-muted-foreground">, </span>
                <span className="text-xs font-normal text-muted-foreground">
                  <BellOff className="inline h-3 w-3 align-text-bottom" />
                  {' '}pending
                </span>
              </>
            )}
          </span>
          {alert.annotations['description'] && (
            <span className="text-xs text-muted-foreground">{renderTextWithLinks(alert.annotations['description'])}</span>
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
      {showSeverityColumn && (
        <td className="px-4 py-2">
          <AlertBadge severity={alert.labels['severity'] ?? 'none'} />
        </td>
      )}
      {showActionsColumn && <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1">
          {silenceType === 'active' && silence && (
            <button
              type="button"
              onClick={() => onExpireSilence?.(silence)}
              title="Expire silence"
              className="cursor-pointer rounded border border-border p-1 text-muted-foreground transition-colors hover:border-border/80 hover:text-foreground"
            >
              <BellMinus className="h-3.5 w-3.5" />
            </button>
          )}
          {silenceType === 'expiring' && silence && (
            <button
              type="button"
              onClick={() => onCreateSilence?.([alert], silence, true)}
              title="Extend silence"
              className="cursor-pointer rounded border border-yellow-700/60 p-1 text-yellow-400 transition-colors hover:border-yellow-500"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          {(silenceType === null || silenceType === undefined) && (
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
      </td>}
      {showClaimColumn && <td className="px-4 py-2 text-sm" onClick={(e) => e.stopPropagation()}>
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
        ) : authMode !== 'none' && !user ? (
          <button
            type="button"
            title="Login required"
            className="cursor-pointer text-muted-foreground/20 transition-colors"
            disabled
          >
            <User className="h-3.5 w-3.5" />
          </button>
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
      </td>}
    </tr>
  )
}
