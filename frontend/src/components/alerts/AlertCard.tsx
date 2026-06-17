import { useState } from 'react'
import { Bell, BellOff, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getFilterableLabels, getSilenceState, formatSilenceDuration, tzAbbr } from '@/lib/alertUtils'
import { renderTextWithLinks } from '@/lib/linkUtils'
import { AlertBadge } from './AlertBadge'
import { HIDDEN_LABEL_KEYS, LabelChip } from './LabelChip'
import { Sheet } from '@/components/ui/sheet'
import { SilenceForm } from '@/components/silences/SilenceForm'
import { useQuery } from '@tanstack/react-query'
import { fetchClusters } from '@/api/client'
import { useAlertStats } from '@/hooks/useAlerts'
import { useFormatTime } from '@/hooks/useFormatTime'
import { useSettingsStore } from '@/store/useSettingsStore'
import type { EnrichedAlert, Silence } from '@/types'

const PAGE_SIZE = 3


interface AlertCardProps {
  alerts: EnrichedAlert[]
  silences: Silence[]
  onClick: (fingerprint: string) => void
  selectedFingerprint?: string | null
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
}: {
  alert: EnrichedAlert
  silences: Silence[]
  onClick: (fp: string) => void
  isSelected: boolean
  commonLabelKeys: Set<string>
}) {
  const { type: silenceType, silence, remaining } = getSilenceState(alert, silences)
  const isResolved = alert.status.state === 'resolved'
  const { data: stats } = useAlertStats(alert.fingerprint)
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

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(alert.fingerprint)}
      onKeyDown={(e) => e.key === 'Enter' && onClick(alert.fingerprint)}
      className={cn(
        'cursor-pointer px-3 py-2.5 transition-colors',
        claim
          ? 'bg-muted/30 hover:bg-muted/50'
          : 'hover:bg-accent/20',
        isSelected && !claim && 'bg-blue-500/10 hover:bg-blue-500/15',
        isSelected && claim && 'bg-muted/50 hover:bg-muted/70',
      )}
    >
      {/* Claim banner */}
      {claim && (
        <div className={cn(
          'mb-2 flex items-start gap-2 rounded px-2 py-1.5 text-xs',
          theme === 'light' ? 'bg-blue-50 border border-blue-200' : 'bg-blue-900/50',
        )}>
          <User className={cn('mt-0.5 h-3 w-3 shrink-0', theme === 'light' ? 'text-blue-600' : 'text-blue-300')} />
          <div className="min-w-0 flex-1">
            <div className={cn('font-semibold', theme === 'light' ? 'text-blue-800' : 'text-blue-200')}>
              In progress: {claim.claimedBy}
            </div>
            <div className={theme === 'light' ? 'text-blue-600' : 'text-blue-400'}>
              {formatTime(claim.claimedAt)}
            </div>
            {claim.note && (
              <div className={cn('mt-0.5', theme === 'light' ? 'text-blue-700' : 'text-blue-300/80')}>
                {claim.note}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Timestamp + maintainer */}
      <div className="mb-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
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

      {/* Labels */}
      {labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {labels.map(([key, value]) => (
            <LabelChip key={key} labelKey={key} value={value} />
          ))}
        </div>
      )}

      {/* Summary / Description */}
      {summary && (
        <p className="text-xs text-muted-foreground">
          <span className="text-muted-foreground/50">summary:</span> {renderTextWithLinks(summary)}
        </p>
      )}
      {description && (
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground/60">
          <span className="text-muted-foreground/40">description:</span> {renderTextWithLinks(description)}
        </p>
      )}
    </div>
  )
}

export function AlertCard({ alerts, silences, onClick, selectedFingerprint }: AlertCardProps) {
  const [page, setPage] = useState(0)
  const [silenceOpen, setSilenceOpen] = useState(false)

  const { data: clusters = [] } = useQuery({
    queryKey: ['clusters'],
    queryFn: fetchClusters,
  })
  const clusterNames = clusters.map((c) => c.name)

  const primary = alerts[0]
  const count = alerts.length
  const severity = primary.labels['severity'] ?? 'none'
  const alertname = primary.labels['alertname'] ?? 'Unknown'

  const totalPages = Math.ceil(count / PAGE_SIZE)
  const start = page * PAGE_SIZE
  const end = Math.min(start + PAGE_SIZE, count)
  const visible = alerts.slice(start, end)

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
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="break-all font-semibold leading-tight text-foreground">{alertname}</span>
        <div className="flex shrink-0 items-center gap-2">
          <AlertBadge severity={severity} />
          {count > 1 && (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold">
              ×{count}
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setSilenceOpen(true)
            }}
            className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
            title="Create silence"
          >
            <Bell className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Silence sheet */}
      <Sheet open={silenceOpen} onClose={() => setSilenceOpen(false)} className="sm:max-w-2xl lg:max-w-3xl">
        <div className="p-5 pt-10">
          <h2 className="mb-4 text-base font-semibold">Create silence</h2>
          <SilenceForm
            availableClusters={clusterNames.length > 0 ? clusterNames : [...new Set(alerts.map((a) => a.clusterName))]}
            prefillAlerts={alerts}
            onSuccess={() => setSilenceOpen(false)}
            onCancel={() => setSilenceOpen(false)}
          />
        </div>
      </Sheet>

      {/* Common labels (shared by all alerts in group) */}
      {sortedCommonLabels.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 py-1.5">
          {sortedCommonLabels.map(([key, value]) => (
            <LabelChip key={key} labelKey={key} value={value} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {count > PAGE_SIZE && (
        <div className="border-b border-border px-4 py-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex h-6 w-6 items-center justify-center rounded border border-border font-bold hover:bg-accent disabled:opacity-30"
            >
              −
            </button>
            <span>
              {start + 1}–{end} of {count}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="flex h-6 w-6 items-center justify-center rounded border border-border font-bold hover:bg-accent disabled:opacity-30"
            >
              +
            </button>
          </div>
        </div>
      )}

      {/* Alert entries */}
      <div className="divide-y divide-border">
        {visible.map((alert) => (
          <AlertEntry
            key={alert.fingerprint}
            alert={alert}
            silences={silences}
            onClick={onClick}
            isSelected={selectedFingerprint === alert.fingerprint}
            commonLabelKeys={commonLabelKeys}
          />
        ))}
      </div>
    </div>
  )
}
