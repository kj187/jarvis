import { useState } from 'react'
import { ArrowUpRight, BellOff, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getFilterableLabels, getSilenceState, getExpiredSilence, formatSilenceDuration, tzAbbr, shortClaimant } from '@/lib/alertUtils'
import { renderTextWithLinks } from '@/lib/linkUtils'
import { bucketFiringStarts } from '@/lib/heatmapUtils'
import { AlertBadge } from './AlertBadge'
import { LabelChip } from './LabelChip'
import { AckButton } from './AckButton'
import { HeatmapCellsRow } from './HeatmapCells'
import { HIDDEN_LABEL_KEYS } from '@/lib/alertUtils'
import { useAlertStats, useAlertHeatmap } from '@/hooks/useAlerts'
import { useFormatTime } from '@/hooks/useFormatTime'
import { useSettingsStore } from '@/store/useSettingsStore'
import { makeAlertSelectionKeyForAlert, matchesAlertSelectionKey } from '@/lib/alertSelection'
import type { EnrichedAlert, Silence } from '@/types'

const PAGE_SIZE = 3


interface AlertCardProps {
  alerts: EnrichedAlert[]
  silences: Silence[]
  onClick: (selectionKey: string, groupKeys?: string[] | null) => void
  selectedFingerprint?: string | null
  onCreateSilence?: (alerts: EnrichedAlert[]) => void
  showSeverityBadge?: boolean
}


// Dezent 14-day firing-pattern sparkline, Karma-style — glance-info only, no
// tooltips (would fight the card's own click target). Fetches the 30d range
// (not 24h) so alerts that recur every few days still show a pattern, then
// keeps only the most recent 14 buckets — fewer, bigger cells read better at
// card width than the full 30. Always rendered, even with zero fires in the
// window — an absent sparkline reads as a rendering bug, not "no data".
function FiringSparkline({
  fingerprint,
  cluster,
}: {
  fingerprint: string
  cluster?: string
}) {
  const { data } = useAlertHeatmap(fingerprint, cluster, '30d', true)
  if (!data) return null
  const cells = bucketFiringStarts(data.firingStarts, '30d').slice(-14)
  return (
    <div className="mb-1">
      <HeatmapCellsRow cells={cells} range="30d" cellClassName="h-2 w-full rounded-sm" gapClassName="gap-0.5" />
    </div>
  )
}

function getCommonLabels(alerts: EnrichedAlert[]): Record<string, string> {
  if (alerts.length === 0) return {}
  const firstLabels = getFilterableLabels(alerts[0])
  const common: Record<string, string> = {}
  for (const [key, value] of Object.entries(firstLabels)) {
    if (HIDDEN_LABEL_KEYS.has(key)) continue
    if (alerts.every((a) => getFilterableLabels(a)[key] === value)) {
      common[key] = value
    }
  }
  return common
}

function AlertEntry({
  alert,
  silences,
  onClick,
  isSelected,
  commonLabelKeys,
  onCreateSilence,
  groupKeys,
  index,
  total,
}: {
  alert: EnrichedAlert
  silences: Silence[]
  onClick: (selectionKey: string, groupKeys?: string[] | null) => void
  isSelected: boolean
  commonLabelKeys: Set<string>
  onCreateSilence?: (alerts: EnrichedAlert[]) => void
  groupKeys: string[] | null
  index: number
  total: number
}) {
  const { type: silenceType, silence, remaining } = getSilenceState(alert, silences)
  const expiredSilence = silenceType === null ? getExpiredSilence(alert, silences) : null
  const isResolved = alert.status.state === 'resolved'
  const { data: stats } = useAlertStats(alert.fingerprint, alert.clusterName)
  const claim = alert.activeClaim ?? null
  const theme = useSettingsStore((s) => s.theme)
  const maintainer = claim ? null : (alert.labels['maintainer'] ?? null)
  const allLabels = getFilterableLabels(alert)
  const formatTime = useFormatTime()
  const labels = Object.entries(allLabels)
    .filter(([k]) => !HIDDEN_LABEL_KEYS.has(k) && !commonLabelKeys.has(k))
    .sort(([a], [b]) => {
      if (a === '@cluster') return -1
      if (b === '@cluster') return 1
      return 0
    })
  const summary = alert.annotations['summary']
  const description = alert.annotations['description']
  // Only dress up entries that share a card with siblings — a lone alert
  // already has the card's own frame.
  const multi = total > 1

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="alert-card"
      data-fingerprint={alert.fingerprint}
      onClick={() => onClick(makeAlertSelectionKeyForAlert(alert), groupKeys)}
      onKeyDown={(e) => e.key === 'Enter' && onClick(makeAlertSelectionKeyForAlert(alert), groupKeys)}
      className={cn(
        'group relative flex cursor-pointer items-start gap-1 px-3 py-3.5 transition-colors focus:outline-none focus-visible:outline-none',
        // Claimed entries carry a blue left accent — "someone's on it", scannable
        // in a large group — not the old grey tint that read as "deprioritised".
        claim ? 'border-l-2 border-blue-400/70 bg-blue-500/10 hover:bg-blue-500/[0.14]' : 'hover:bg-accent/20',
        isSelected && !claim && 'bg-blue-500/10 hover:bg-blue-500/15',
        isSelected && claim && 'bg-blue-500/20 hover:bg-blue-500/25',
      )}
    >
      <div className="min-w-0 flex-1">
        {/* Claim info — above the identity line: "who's on it" outranks "which
            alert is it". One quiet line by default; a padded box only when
            there's a note worth the space */}
        {claim && (
          claim.note ? (
            <div className={cn(
              'mb-2 flex items-start gap-2 rounded border-l-2 border-blue-400 px-2 py-1.5 text-xs',
              theme === 'light' ? 'bg-blue-50 text-blue-800' : 'bg-blue-500/10 text-blue-200',
            )}>
              <User className="mt-0.5 h-3 w-3 shrink-0 text-blue-400" />
              <div className="min-w-0 flex-1">
                <div title={claim.claimedBy}>
                  <span className="opacity-70">Claimed by: </span>
                  <span className="font-medium">{shortClaimant(claim.claimedBy)}</span>
                  <span className="opacity-70"> · {formatTime(claim.claimedAt)}</span>
                </div>
                <div className={cn('mt-0.5', theme === 'light' ? 'text-blue-700' : 'text-blue-300/80')}>
                  {claim.note}
                </div>
              </div>
            </div>
          ) : (
            <div
              className={cn('mb-1.5 flex items-center gap-1.5 text-xs', theme === 'light' ? 'text-blue-700' : 'text-blue-300')}
              title={claim.claimedBy}
            >
              <User className="h-3 w-3 shrink-0" />
              <span className="min-w-0 truncate">
                <span className="opacity-70">Claimed by: </span>
                <span className="font-medium">{shortClaimant(claim.claimedBy)}</span>
                <span className="opacity-70"> · {formatTime(claim.claimedAt)}</span>
              </span>
            </div>
          )
        )}

        {/* Identity line — position within the group + distinguishing labels,
            so each sibling alert reads as its own unit */}
        {multi && (
          <div className="mb-1 flex items-start gap-2">
            <span className="mt-px shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {index + 1}/{total}
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {labels.map(([key, value], i) => (
                <LabelChip key={key} labelKey={key} value={value} emphasized={i === 0} />
              ))}
            </div>
          </div>
        )}

        {/* Timestamp + maintainer */}
        <div className="mb-0.5 flex flex-col gap-0.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span title={new Date(alert.startsAt).toLocaleString('en-US')}>
              {new Date(alert.startsAt) > new Date()
                ? `Expires ${formatTime(alert.endsAt)}`
                : formatTime(alert.startsAt)}
            </span>
            {stats && stats.occurrenceCount > 1 && (
              <span title={`${stats.occurrenceCount}× occurred`}>↻{stats.occurrenceCount}×</span>
            )}
            {maintainer && <span>{maintainer}</span>}
          </div>
          {isResolved && stats?.lastResolvedAt && (
            <span className="text-green-600/70" title={new Date(stats.lastResolvedAt).toLocaleString('en-US')}>
              ✓ {formatTime(stats.lastResolvedAt)}
            </span>
          )}
        </div>

        {/* Firing pattern sparkline */}
        <FiringSparkline
          fingerprint={alert.fingerprint}
          cluster={alert.clusterName}
        />

        {/* Silence banner */}
        {silenceType === 'active' && silence && remaining !== undefined && (
          <div className="mb-2 flex items-center gap-1.5 rounded bg-muted px-2 py-1.5 text-xs">
            <BellOff className="h-3 w-3 shrink-0 text-muted-foreground" />
            <div>
              <div className="font-semibold text-foreground">SILENCE ACTIVE</div>
              <div className="text-muted-foreground">Ends in {formatSilenceDuration(remaining)}</div>
            </div>
          </div>
        )}
        {silenceType === 'expiring' && remaining !== undefined && (
          <div className={cn(
            'mb-2 flex items-center gap-1.5 rounded px-2 py-1.5 text-xs',
            theme === 'light' ? 'bg-amber-50 border border-amber-200 text-amber-700' : 'bg-yellow-900/40 text-yellow-300',
          )}>
            <BellOff className="h-3 w-3 shrink-0" />
            <span>Silence expires in {formatSilenceDuration(remaining)}</span>
          </div>
        )}
        {silenceType === 'pending' && silence && (
          <div className="mb-2 rounded bg-muted px-2 py-1.5 text-xs text-muted-foreground">
            ⏳ Silence from{' '}
            {new Date(silence.startsAt).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            })} {tzAbbr}
          </div>
        )}
        {expiredSilence && (
          <div className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground/60">
            <BellOff className="h-3 w-3 shrink-0" />
            <span title={new Date(expiredSilence.endsAt).toLocaleString('en-US')}>
              Silence expired {formatTime(expiredSilence.endsAt)}
            </span>
          </div>
        )}

        {/* Summary / Description — both kept (they can carry different text),
            but clamped in the card; full text on hover and in the detail panel */}
        {summary && (
          <p className="line-clamp-1 text-xs text-muted-foreground" title={summary}>
            {renderTextWithLinks(summary)}
          </p>
        )}
        {description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground/60" title={description}>
            {renderTextWithLinks(description)}
          </p>
        )}
      </div>

      {/* Persistent action rail — always visible, deliberately subtle */}
      <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
        <ArrowUpRight
          className="h-3.5 w-3.5 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground"
          aria-hidden="true"
        />
        <AckButton alerts={[alert]} silences={silences} variant="icon" onCreateSilence={onCreateSilence} />
      </div>
    </div>
  )
}

export function AlertCard({
  alerts,
  silences,
  onClick,
  selectedFingerprint,
  onCreateSilence,
  showSeverityBadge = true,
}: AlertCardProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const primary = alerts[0]
  const count = alerts.length
  const severityRaw = primary.labels['severity']
  const severity = primary.labels['severity'] ?? 'none'
  const alertname = primary.labels['alertname'] ?? 'Unknown'
  const storageKey = `jarvis:collapsed:${alertname}:${primary.labels['@cluster'] ?? ''}`

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(storageKey) === 'true' } catch { return false }
  })

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c
      try { localStorage.setItem(storageKey, String(next)) } catch {}
      return next
    })
  }

  const visible = alerts.slice(0, visibleCount)
  const claimedCount = alerts.filter((a) => a.activeClaim != null).length
  const groupKeys = alerts.length > 1 ? alerts.map(makeAlertSelectionKeyForAlert) : null

  const commonLabels = getCommonLabels(alerts)
  const commonLabelKeys = new Set(Object.keys(commonLabels))
  const sortedCommonLabels = Object.entries(commonLabels).sort(([a], [b]) => {
    if (a === '@cluster') return -1
    if (b === '@cluster') return 1
    return 0
  })

  const severityBorderColor: Record<string, string> = {
    critical: 'border-l-red-500',
    warning: 'border-l-yellow-500',
    info: 'border-l-blue-500',
    none: 'border-l-slate-500',
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-border bg-card shadow-sm',
        'border-l-4',
        severityBorderColor[severity] ?? 'border-l-slate-500',
      )}
    >
      {/* Card header */}
      <div
        className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 select-none"
        onDoubleClick={toggleCollapsed}
        title="Double-click to collapse"
      >
        <span className="break-all font-semibold leading-tight text-foreground">{alertname}</span>
        <div className="flex shrink-0 items-center gap-2" title="">
          {showSeverityBadge && severityRaw && <AlertBadge severity={severity} />}
          {count > 1 && (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold">
              ×{count}
            </span>
          )}
          {claimedCount > 0 && (
            <span
              className="flex h-5 items-center gap-0.5 rounded-full bg-blue-500/20 px-1.5 text-xs font-medium text-blue-400"
              title={`${claimedCount} of ${count} claimed`}
            >
              <User className="h-2.5 w-2.5" />
              {count === 1 ? 'Claimed' : `Claimed ${claimedCount}/${count}`}
            </span>
          )}
          <AckButton
            alerts={alerts}
            silences={silences}
            variant="icon"
            subtle={false}
            requireActive={false}
            onCreateSilence={onCreateSilence}
          />
        </div>
      </div>

      {/* Common labels — shared by every alert in the group, so rendered as a
          quiet context strip (neutral, no per-key hue) that doesn't compete
          with each entry's own distinguishing labels */}
      {!collapsed && sortedCommonLabels.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-border/60 px-3 py-2">
          {sortedCommonLabels.map(([key, value]) => (
            <LabelChip key={key} labelKey={key} value={value} muted />
          ))}
        </div>
      )}

      {/* Alert entries */}
      {!collapsed && (
        <div className="divide-y divide-border bg-muted/10">
          {visible.map((alert, idx) => (
            <AlertEntry
              key={`${alert.clusterName}:${alert.fingerprint}:${alert.startsAt}`}
              alert={alert}
              silences={silences}
              onClick={onClick}
              isSelected={matchesAlertSelectionKey(alert, selectedFingerprint)}
              commonLabelKeys={commonLabelKeys}
              onCreateSilence={onCreateSilence}
              groupKeys={groupKeys}
              index={idx}
              total={count}
            />
          ))}
        </div>
      )}

      {/* Show more / less */}
      {!collapsed && count > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <button
            onClick={() => setVisibleCount((n) => Math.max(PAGE_SIZE, n - PAGE_SIZE))}
            disabled={visibleCount <= PAGE_SIZE}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-border font-bold hover:bg-accent disabled:cursor-default disabled:opacity-30"
          >
            −
          </button>
          <span>{visibleCount} of {count}</span>
          <button
            onClick={() => setVisibleCount((n) => Math.min(count, n + PAGE_SIZE))}
            disabled={visibleCount >= count}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-border font-bold hover:bg-accent disabled:cursor-default disabled:opacity-30"
          >
            +
          </button>
        </div>
      )}
    </div>
  )
}
