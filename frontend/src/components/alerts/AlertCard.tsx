import { formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'
import { BellOff, Clock, ExternalLink, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AlertBadge } from './AlertBadge'
import type { EnrichedAlert, Silence } from '@/types'

interface AlertCardProps {
  alerts: EnrichedAlert[]
  silences: Silence[]
  onClick: (fingerprint: string) => void
  selectedFingerprint?: string | null
}

function getSilenceState(alert: EnrichedAlert, silences: Silence[]): {
  type: 'pending' | 'expiring' | 'expired' | null
  silence: Silence | null
  remaining?: number
} {
  const now = Date.now()
  const FIFTEEN_MIN = 15 * 60 * 1000
  const TWO_HOURS = 2 * 60 * 60 * 1000

  for (const silenceId of alert.status.silencedBy) {
    const silence = silences.find((s) => s.id === silenceId)
    if (!silence) continue
    const endsAt = new Date(silence.endsAt).getTime()
    const startsAt = new Date(silence.startsAt).getTime()
    if (silence.status.state === 'pending') {
      return { type: 'pending', silence }
    }
    if (silence.status.state === 'active') {
      const remaining = endsAt - now
      if (remaining <= FIFTEEN_MIN) return { type: 'expiring', silence, remaining }
    }
    if (silence.status.state === 'expired') {
      const expiredAgo = now - endsAt
      if (expiredAgo <= TWO_HOURS) return { type: 'expired', silence }
      return { type: 'expired', silence }
    }
  }
  return { type: null, silence: null }
}

function ClaimAvatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <div className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white shadow ring-2 ring-card">
      {initials || <User className="h-3 w-3" />}
    </div>
  )
}

export function AlertCard({ alerts, silences, onClick, selectedFingerprint }: AlertCardProps) {
  const primary = alerts[0]
  const count = alerts.length
  const severity = primary.labels['severity'] ?? 'none'
  const alertname = primary.labels['alertname'] ?? 'Unknown'
  const isResolved = primary.status.state === 'resolved'
  const { type: silenceType, silence, remaining } = getSilenceState(primary, silences)
  const isSelected = selectedFingerprint === primary.fingerprint

  const severityBorderColor: Record<string, string> = {
    critical: 'border-l-red-500',
    warning: 'border-l-yellow-500',
    info: 'border-l-blue-500',
    none: 'border-l-slate-500',
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(primary.fingerprint)}
      onKeyDown={(e) => e.key === 'Enter' && onClick(primary.fingerprint)}
      className={cn(
        'relative cursor-pointer rounded-lg border border-border bg-card p-4 shadow-sm transition-all hover:border-accent',
        'border-l-4',
        severityBorderColor[severity] ?? 'border-l-slate-500',
        isResolved && 'opacity-50',
        isSelected && 'ring-2 ring-blue-500',
      )}
    >
      {/* Claim avatar */}
      {primary.activeClaim && (
        <ClaimAvatar name={primary.activeClaim.claimedBy} />
      )}

      {/* Count badge */}
      {count > 1 && (
        <div className="absolute right-3 top-3 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold">
          ×{count}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2 pr-6">
          <span className="font-semibold text-foreground leading-tight break-all">{alertname}</span>
          <AlertBadge severity={severity} />
        </div>

        <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          {primary.clusterName && (
            <span className="rounded bg-accent px-1.5 py-0.5">{primary.clusterName}</span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDistanceToNow(new Date(primary.startsAt), { addSuffix: true, locale: de })}
          </span>
        </div>

        {/* Silence indicators */}
        {silenceType === 'pending' && silence && (
          <div className="flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">
            ⏳ Silence ab{' '}
            {new Date(silence.startsAt).toLocaleTimeString('de-DE', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        )}
        {silenceType === 'expiring' && (
          <div className="flex items-center gap-1 rounded bg-yellow-900/40 px-2 py-1 text-xs text-yellow-300">
            ⚠️ Silence läuft ab in{' '}
            {remaining !== undefined ? Math.ceil(remaining / 60_000) : '?'} Min.
          </div>
        )}
        {silenceType === 'expired' && silence && (
          <div className="flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-xs text-slate-400">
            <BellOff className="h-3 w-3" />
            Silence expired vor{' '}
            {formatDistanceToNow(new Date(silence.endsAt), { locale: de })}
          </div>
        )}

        {/* Alertmanager link */}
        {primary.alertmanagerUrl && (
          <a
            href={primary.alertmanagerUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            Alertmanager
          </a>
        )}
      </div>
    </div>
  )
}
