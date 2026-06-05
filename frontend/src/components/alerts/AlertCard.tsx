import React, { useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'
import { BellOff, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getFilterableLabels } from '@/lib/alertUtils'
import { useUIStore } from '@/store/uiStore'
import { AlertBadge } from './AlertBadge'
import type { EnrichedAlert, LabelMatcherOperator, Silence } from '@/types'

const PAGE_SIZE = 3

const HIDDEN_LABEL_KEYS = new Set(['alertname', 'severity', 'receiver', '@receiver'])

function labelColorStyle(key: string): React.CSSProperties {
  let h = 5381
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0
  const hue = h % 360
  return {
    backgroundColor: `hsl(${hue} 40% 16%)`,
    color: `hsl(${hue} 70% 72%)`,
    borderColor: `hsl(${hue} 35% 30%)`,
  }
}

const OPERATORS: LabelMatcherOperator[] = ['=', '!=', '=~', '!~']

function LabelChip({ labelKey, value }: { labelKey: string; value: string }) {
  const [open, setOpen] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addLabelMatcher = useUIStore((s) => s.addLabelMatcher)

  const show = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setOpen(true)
  }
  const hide = () => {
    hideTimer.current = setTimeout(() => setOpen(false), 120)
  }

  const apply = (op: LabelMatcherOperator, e: React.MouseEvent) => {
    e.stopPropagation()
    addLabelMatcher({ name: labelKey, operator: op, value })
    setOpen(false)
  }

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onClick={(e) => e.stopPropagation()}
    >
      <span
        className="max-w-[200px] truncate rounded border px-1.5 py-0.5 text-[10px] font-medium"
        style={labelColorStyle(labelKey)}
      >
        {labelKey}: {value}
      </span>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-0.5 flex items-center gap-px rounded border border-border bg-popover p-0.5 shadow-md"
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          {OPERATORS.map((op) => (
            <button
              key={op}
              onClick={(e) => apply(op, e)}
              className="rounded px-2 py-0.5 font-mono text-[11px] font-bold text-foreground hover:bg-accent"
            >
              {op}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface AlertCardProps {
  alerts: EnrichedAlert[]
  silences: Silence[]
  onClick: (fingerprint: string) => void
  selectedFingerprint?: string | null
}

function getSilenceState(alert: EnrichedAlert, silences: Silence[]): {
  type: 'pending' | 'active' | 'expiring' | null
  silence: Silence | null
  remaining?: number
} {
  const now = Date.now()
  const FIFTEEN_MIN = 15 * 60 * 1000

  for (const silenceId of alert.status.silencedBy) {
    const silence = silences.find((s) => s.id === silenceId)
    if (!silence) continue
    const endsAt = new Date(silence.endsAt).getTime()
    const remaining = endsAt - now
    if (silence.status.state === 'pending') return { type: 'pending', silence }
    if (silence.status.state === 'active') {
      if (remaining <= FIFTEEN_MIN) return { type: 'expiring', silence, remaining }
      return { type: 'active', silence, remaining }
    }
  }
  return { type: null, silence: null }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const months = Math.floor(days / 30)
  const years = Math.floor(days / 365)

  if (years >= 1) {
    const remMonths = Math.floor((days - years * 365) / 30)
    return remMonths > 0
      ? `${years} Jahr${years > 1 ? 'e' : ''} ${remMonths} Monat${remMonths > 1 ? 'e' : ''}`
      : `${years} Jahr${years > 1 ? 'e' : ''}`
  }
  if (months >= 1) {
    const remDays = days - months * 30
    return remDays > 0
      ? `${months} Monat${months > 1 ? 'e' : ''} ${remDays} Tag${remDays > 1 ? 'e' : ''}`
      : `${months} Monat${months > 1 ? 'e' : ''}`
  }
  if (days >= 1) {
    const remHours = hours - days * 24
    return remHours > 0
      ? `${days} Tag${days > 1 ? 'e' : ''} ${remHours} Std.`
      : `${days} Tag${days > 1 ? 'e' : ''}`
  }
  if (hours >= 1) {
    const remMinutes = minutes - hours * 60
    return remMinutes > 0
      ? `${hours} Std. ${remMinutes} Min.`
      : `${hours} Std.`
  }
  if (minutes >= 1) return `${minutes} Min.`
  return 'wenige Sekunden'
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
  const claim = alert.activeClaim ?? null
  const maintainer = claim ? null : (alert.labels['maintainer'] ?? null)
  const allLabels = getFilterableLabels(alert)
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
        'cursor-pointer rounded-md border bg-background/20 p-2 transition-colors',
        claim
          ? 'border-blue-500/50 bg-blue-950/30 hover:bg-blue-950/40'
          : 'border-border/40 hover:bg-accent/20',
        isSelected && !claim && 'border-blue-500/50 bg-blue-500/10',
        isSelected && claim && 'border-blue-400/80 bg-blue-900/30',
      )}
    >
      {/* Claim banner */}
      {claim && (
        <div className="mb-2 flex items-start gap-2 rounded bg-blue-900/50 px-2 py-1.5 text-xs">
          <User className="mt-0.5 h-3 w-3 shrink-0 text-blue-300" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-blue-200">In Bearbeitung: {claim.claimedBy}</div>
            <div className="text-blue-400">
              {formatDistanceToNow(new Date(claim.claimedAt), { addSuffix: true, locale: de })}
            </div>
            {claim.note && <div className="mt-0.5 text-blue-300/80">{claim.note}</div>}
          </div>
        </div>
      )}

      {/* Timestamp + maintainer */}
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {formatDistanceToNow(new Date(alert.startsAt), { addSuffix: true, locale: de })}
        </span>
        {maintainer && <span>{maintainer}</span>}
      </div>

      {/* Silence banner */}
      {silenceType === 'active' && silence && remaining !== undefined && (
        <div className="mb-2 flex items-center gap-1.5 rounded bg-slate-800 px-2 py-1.5 text-xs">
          <BellOff className="h-3 w-3 shrink-0 text-slate-400" />
          <div>
            <div className="font-semibold text-slate-200">SILENCE AKTIV</div>
            <div className="text-slate-400">Endet in {formatDuration(remaining)}</div>
          </div>
        </div>
      )}
      {silenceType === 'expiring' && remaining !== undefined && (
        <div className="mb-2 flex items-center gap-1.5 rounded bg-yellow-900/40 px-2 py-1.5 text-xs text-yellow-300">
          <BellOff className="h-3 w-3 shrink-0" />
          <span>Silence läuft ab in {formatDuration(remaining)}</span>
        </div>
      )}
      {silenceType === 'pending' && silence && (
        <div className="mb-2 rounded bg-slate-800 px-2 py-1.5 text-xs text-slate-300">
          ⏳ Silence ab{' '}
          {new Date(silence.startsAt).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
          })}
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
          <span className="text-muted-foreground/50">summary:</span> {summary}
        </p>
      )}
      {description && (
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground/60">
          <span className="text-muted-foreground/40">description:</span> {description}
        </p>
      )}
    </div>
  )
}

export function AlertCard({ alerts, silences, onClick, selectedFingerprint }: AlertCardProps) {
  const [page, setPage] = useState(0)

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
        'rounded-lg border border-border bg-card shadow-sm',
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
        </div>
      </div>

      {/* Common labels (shared by all alerts in group) */}
      {sortedCommonLabels.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-border px-3 py-1.5">
          {sortedCommonLabels.map(([key, value]) => (
            <LabelChip key={key} labelKey={key} value={value} />
          ))}
        </div>
      )}

      {/* Alert entries */}
      <div className="flex flex-col gap-1.5 p-1.5">
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

      {/* Pagination */}
      {count > PAGE_SIZE && (
        <div className="border-t border-border px-4 py-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex h-6 w-6 items-center justify-center rounded border border-border font-bold hover:bg-accent disabled:opacity-30"
            >
              −
            </button>
            <span>
              {start + 1}–{end} von {count}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="flex h-6 w-6 items-center justify-center rounded border border-border font-bold hover:bg-accent disabled:opacity-30"
            >
              +
            </button>
          </div>
          <p className="mt-1 text-center text-[10px] text-muted-foreground/50">
            Jeder Eintrag ist einzeln anklickbar.
          </p>
        </div>
      )}
    </div>
  )
}
