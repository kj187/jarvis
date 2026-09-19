import { BellMinus, BellOff, User } from 'lucide-react'
import { AlertBadge, StatusBadge } from './AlertBadge'
import { AckButton } from './AckButton'
import { ExtendSilenceMenu } from '@/components/silences/ExtendSilenceMenu'
import { LabelChip, HiddenLabelsToggle } from './LabelChip'
import { useAlertStats } from '@/hooks/useAlerts'
import { getFilterableLabels, getSilenceState, formatSilenceDuration, shortClaimant, partitionLabelsForDisplay } from '@/lib/alertUtils'
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
  const labelDisplay = useSettingsStore((s) => s.labelDisplay)

  const { data: stats } = useAlertStats(alert.fingerprint, alert.clusterName)
  const formatTime = useFormatTime()

  const { type: silenceType, silence, remaining } = silences
    ? getSilenceState(alert, silences)
    : { type: null as null, silence: null, remaining: undefined }

  // Remove shared key/value pairs before partitioning (excludeLabels matches on
  // key *and* value). getFilterableLabels lets @cluster follow the same
  // pin/hide rules as every other label instead of being a special chip.
  const rowLabels = Object.fromEntries(
    Object.entries(getFilterableLabels(alert)).filter(([key, value]) => excludeLabels?.[key] !== value),
  )
  const partitioned = partitionLabelsForDisplay(rowLabels, labelDisplay)
  let uniqueLabels = partitioned.visible
  // HIDDEN_LABEL_KEYS drops severity above — re-add it at the front when
  // explicitly requested, subject to the same excludeLabels value check.
  if (includeSeverityLabelChip && alert.labels['severity'] !== undefined && excludeLabels?.['severity'] !== alert.labels['severity']) {
    uniqueLabels = [['severity', alert.labels['severity']], ...uniqueLabels]
  }
  const hiddenLabels = partitioned.hidden

  // Claim is read-only in the list (claim/release lives in the detail panel) —
  // just the "who's on it" line, styled and placed like the card.
  const claim = alert.activeClaim
  const claimLine = claim ? (
    <span className="flex items-center gap-1 text-xs text-claim-fg" title={claim.claimedBy}>
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
          <span className={cn('text-xs font-normal', 'text-warning-fg')} title={`Silence expires in ${formatSilenceDuration(remaining)}`}>
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
  // own distinguishing labels instead (first one emphasized).
  const chipRow = (
    <div className="flex flex-wrap items-center gap-1 pt-0.5">
      {uniqueLabels.map(([key, value], i) => (
        <LabelChip key={key} labelKey={key} value={value} emphasized={indented && i === 0} />
      ))}
      <HiddenLabelsToggle hidden={hiddenLabels} />
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
        claim && !selected && 'bg-claim-soft hover:bg-selected',
        isLastInGroup && 'border-b border-border/60',
        isResolved && !noOpacity && 'opacity-50',
        selected && 'bg-accent',
      )}
    >
      <td className={cn('px-4 py-2 border-l-2', indented && 'pl-10', claim ? 'border-claim-edge' : 'border-transparent')}>
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
          {(silenceType === 'active' || silenceType === 'expiring') && silence && (
            <ExtendSilenceMenu silences={[silence]} fingerprint={alert.fingerprint} tone={silenceType === 'expiring' ? 'warning' : 'default'} />
          )}
          {silenceType === 'active' && silence && (
            <button
              type="button"
              onClick={() => onExpireSilence?.(silence)}
              title="Expire silence"
              className="cursor-pointer rounded-compact border border-border p-1 text-muted-foreground transition-colors hover:border-border/80 hover:text-foreground"
            >
              <BellMinus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </td>}
    </tr>
  )
}
