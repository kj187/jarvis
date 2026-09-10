import { BellMinus, BellOff, RefreshCw, User } from 'lucide-react'
import { AlertBadge, StatusBadge } from './AlertBadge'
import { AckButton } from './AckButton'
import { LabelChip } from './LabelChip'
import { HIDDEN_LABEL_KEYS } from '@/lib/alertUtils'
import { useAlertStats } from '@/hooks/useAlerts'
import { getSilenceState, formatSilenceDuration, shortClaimant } from '@/lib/alertUtils'
import { renderTextWithLinks } from '@/lib/linkUtils'
import { useFormatTime } from '@/hooks/useFormatTime'
import { makeAlertSelectionKeyForAlert } from '@/lib/alertSelection'
import type { EnrichedAlert, Silence } from '@/types'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/store/useSettingsStore'

interface AlertListRowProps {
  alert: EnrichedAlert
  onClick: (selectionKey: string) => void
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
  noOpacity?: boolean
  includeSeverityLabelChip?: boolean
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
  noOpacity = false,
  includeSeverityLabelChip = false,
}: AlertListRowProps) {
  const alertname = alert.labels['alertname'] ?? '—'
  const isResolved = alert.status.state === 'resolved'
  const theme = useSettingsStore((s) => s.theme)

  const { data: stats } = useAlertStats(alert.fingerprint, alert.clusterName)
  const formatTime = useFormatTime()

  const { type: silenceType, silence, remaining } = silences
    ? getSilenceState(alert, silences)
    : { type: null as null, silence: null, remaining: undefined }

  const uniqueLabels = Object.entries(alert.labels).filter(
    ([key, value]) =>
      ((!HIDDEN_LABEL_KEYS.has(key)) || (includeSeverityLabelChip && key === 'severity')) &&
      !key.startsWith('__') &&
      excludeLabels?.[key] !== value,
  )

  // Claim is read-only in the list (claim/release lives in the detail panel) —
  // just the "who's on it" line, styled and placed like the card.
  const claim = alert.activeClaim
  const claimLine = claim ? (
    <span className="flex items-center gap-1 text-xs text-blue-400" title={claim.claimedBy}>
      <User className="h-3 w-3 shrink-0" />
      <span className="truncate">
        <span className="opacity-70">Claimed by: </span>
        <span className="font-medium">{shortClaimant(claim.claimedBy)}</span>
        <span className="opacity-70"> · {formatTime(claim.claimedAt)}</span>
      </span>
    </span>
  ) : null

  const metaLine = (
    <span className="font-medium">
      {!indented && (
        <>
          {alertname}
          <span className="font-normal text-muted-foreground">, </span>
        </>
      )}
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
  )
  const descLine = alert.annotations['description'] ? (
    <span className="text-xs text-muted-foreground">{renderTextWithLinks(alert.annotations['description'])}</span>
  ) : null
  // Inside a group the alertname is the group heading — lead each row with its
  // own distinguishing labels instead (first one emphasized), context muted.
  const chipRow = (
    <div className="flex flex-wrap items-center gap-1 pt-0.5">
      <LabelChip labelKey="@cluster" value={alert.clusterName} muted={indented} />
      {uniqueLabels.map(([key, value], i) => (
        <LabelChip key={key} labelKey={key} value={value} emphasized={indented && i === 0} />
      ))}
    </div>
  )

  return (
    <tr
      role="row"
      tabIndex={0}
      data-testid="alert-list-row"
      onClick={() => onClick(makeAlertSelectionKeyForAlert(alert))}
      onKeyDown={(e) => e.key === 'Enter' && onClick(makeAlertSelectionKeyForAlert(alert))}
      className={cn(
        'cursor-pointer transition-colors hover:bg-accent/50 focus:outline-none focus-visible:outline-none',
        indented && !selected && !claim && (theme === 'light' ? 'bg-background' : 'bg-background/60'),
        claim && !selected && (theme === 'light' ? 'bg-blue-50 hover:bg-blue-100/80' : 'bg-blue-950/30 hover:bg-blue-950/50'),
        isLastInGroup && 'border-b border-border/60',
        isResolved && !noOpacity && 'opacity-50',
        selected && 'bg-accent',
      )}
    >
      <td className={cn('px-4 py-2 border-l-2', indented && 'pl-10', claim ? 'border-blue-600/70' : 'border-transparent')}>
        <div className="flex flex-col gap-0.5">
          {indented ? (
            <>{claimLine}{chipRow}{metaLine}{descLine}</>
          ) : (
            <>{metaLine}{claimLine}{descLine}{chipRow}</>
          )}
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
          {silences && (
            <AckButton
              alerts={[alert]}
              silences={silences}
              variant="icon"
              subtle={false}
              requireActive={false}
              onCreateSilence={onCreateSilence ? (a) => onCreateSilence(a) : undefined}
            />
          )}
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
        </div>
      </td>}
    </tr>
  )
}
