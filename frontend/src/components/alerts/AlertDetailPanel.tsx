import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { ExternalLink, BookOpen, ChevronDown, ChevronUp, BellOff, Pencil, Trash2, User, Info, Server } from 'lucide-react'
import { TruncatableChip } from '@/components/ui/truncatable-chip'
import { cn } from '@/lib/utils'
import { Sheet } from '@/components/ui/sheet'
import { AlertBadge, StatusBadge } from './AlertBadge'
import { labelColorStyle } from '@/lib/alertUtils'
import { AlertComments } from './AlertComments'
import { AlertDetailHistorySection } from './AlertDetailHistorySection'
import { AlertDetailSection } from './AlertDetailSection'
import { SilenceForm } from '@/components/silences/SilenceForm'
import { useAlerts, useAlertTimeline, useAlertStats } from '@/hooks/useAlerts'
import { useFormatTime } from '@/hooks/useFormatTime'
import { useActiveClaim, useClaimController, USERNAME_KEY } from '@/hooks/useAlertClaim'
import { useDeleteSilence, useUpsertSilence } from '@/hooks/useSilences'
import { useAuthStore } from '@/store/authStore'
import { useLoginGuard } from '@/hooks/useLoginGuard'
import { LoginModal } from '@/components/auth/LoginModal'
import { useSettingsStore } from '@/store/useSettingsStore'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import { makeAlertSelectionKeyForAlert } from '@/lib/alertSelection'
import type { EnrichedAlert, LabelMatcher, Silence, SilenceMatcher } from '@/types'
import { renderTextWithLinks, extractLinkButtons } from '@/lib/linkUtils'
import { pickIdentifierLabel, tzAbbr } from '@/lib/alertUtils'

const ALERT_EVENT_LABEL: Record<string, string> = {
  firing: 'Alert fired',
  suppressed: 'Alert suppressed',
  expired: 'Silence expired',
  resolved: 'Alert resolved',
}
const SILENCE_ACTION_LABEL: Record<string, string> = {
  pending: 'Silence pending',
  created: 'Silence created',
  updated: 'Silence updated',
  deleted: 'Silence deleted',
  expired: 'Silence expired',
}

function toHistoryAction(source: 'alert' | 'claim' | 'silence', action: string): string {
  if (source === 'alert') return ALERT_EVENT_LABEL[action] ?? action
  if (source === 'silence') return SILENCE_ACTION_LABEL[action] ?? `Silence ${action}`
  return action
}

const promptCache = new Map<string, string>()

function getCachedPrompt(cacheKey: string, build: () => string): string {
  const cached = promptCache.get(cacheKey)
  if (cached !== undefined) return cached
  const prompt = build()
  promptCache.set(cacheKey, prompt)
  if (promptCache.size > 100) {
    const oldest = promptCache.keys().next().value
    if (oldest) promptCache.delete(oldest)
  }
  return prompt
}

// ── Silence helpers ───────────────────────────────────────────────────────────

function matcherOp(m: SilenceMatcher): string {
  if (m.isRegex) return m.isEqual ? '=~' : '!~'
  return m.isEqual ? '=' : '!='
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
      ? `${years} year${years > 1 ? 's' : ''} ${remMonths} month${remMonths > 1 ? 's' : ''}`
      : `${years} year${years > 1 ? 's' : ''}`
  }
  if (months >= 1) {
    const remDays = days - months * 30
    return remDays > 0
      ? `${months} month${months > 1 ? 's' : ''} ${remDays} day${remDays > 1 ? 's' : ''}`
      : `${months} month${months > 1 ? 's' : ''}`
  }
  if (days >= 1) {
    const remHours = hours - days * 24
    return remHours > 0
      ? `${days} day${days > 1 ? 's' : ''} ${remHours}h`
      : `${days} day${days > 1 ? 's' : ''}`
  }
  if (hours >= 1) {
    const remMinutes = minutes - hours * 60
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`
  }
  if (minutes >= 1) return `${minutes}m`
  return 'a few seconds'
}

function silenceMatchesAlert(silence: Silence, alert: EnrichedAlert): boolean {
  const labels: Record<string, string> = { ...alert.labels, '@cluster': alert.clusterName }
  return silence.matchers.every((m) => {
    const value = labels[m.name] ?? ''
    if (m.isRegex) {
      try {
        const re = new RegExp(m.value)
        return m.isEqual ? re.test(value) : !re.test(value)
      } catch {
        return false
      }
    }
    return m.isEqual ? value === m.value : value !== m.value
  })
}

function MatcherChip({ matcher }: { matcher: SilenceMatcher }) {
  const theme = useSettingsStore((s) => s.theme)
  return (
    <TruncatableChip
      className="rounded border px-1.5 py-0.5 text-[10px] font-medium"
      style={labelColorStyle(matcher.name, theme)}
    >
      {matcher.name}{matcherOp(matcher)}{matcher.value}
    </TruncatableChip>
  )
}

// ── Affected alerts (silence banner) ──────────────────────────────────────────

function AffectedAlertRow({
  alert,
  idKey,
  isCurrent,
  onSelect,
}: {
  alert: EnrichedAlert
  idKey: string | null
  isCurrent: boolean
  onSelect?: () => void
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 text-xs rounded px-1 -mx-1 py-0.5 w-full',
        onSelect && !isCurrent && 'cursor-pointer hover:bg-accent'
      )}
      onClick={onSelect}
    >
      <span className="font-medium text-foreground shrink-0">{alert.labels['alertname'] ?? alert.fingerprint}</span>
      {idKey && alert.labels[idKey] != null && (
        <span className="truncate font-mono text-[11px] text-muted-foreground" title={`${idKey}=${alert.labels[idKey]}`}>
          {alert.labels[idKey]}
        </span>
      )}
      {isCurrent && (
        <span className="ml-auto rounded bg-primary/15 px-1 py-0.5 text-[10px] font-medium text-primary shrink-0">this alert</span>
      )}
    </div>
  )
}

function AffectedAlertsSection({
  affected,
  currentAlert,
  onSelectAlert,
}: {
  affected: EnrichedAlert[]
  currentAlert: EnrichedAlert
  onSelectAlert?: (selectionKey: string) => void
}) {
  const [open, setOpen] = useState(false)
  const idKey = pickIdentifierLabel(affected)
  return (
    <div className="mt-2">
      <button
        className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Affected Alerts ({affected.length})
      </button>
      {open && (
        <div className="combo-dropdown max-h-80 overflow-y-auto overflow-x-hidden space-y-0.5">
          {affected.map((a) => {
            const isCurrent = a.fingerprint === currentAlert.fingerprint && a.clusterName === currentAlert.clusterName
            return (
              <AffectedAlertRow
                key={`${a.clusterName}:${a.fingerprint}:${a.startsAt}`}
                alert={a}
                idKey={idKey}
                isCurrent={isCurrent}
                onSelect={onSelectAlert && !isCurrent ? () => onSelectAlert(makeAlertSelectionKeyForAlert(a)) : undefined}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

interface AlertDetailPanelProps {
  alert: EnrichedAlert | null
  onClose: () => void
  onAddLabelMatcher: (matcher: Omit<LabelMatcher, 'id'>) => void
  runbookBaseUrl?: string
  silences: Silence[]
  onSelectAlert?: (selectionKey: string) => void
}

export function AlertDetailPanel({
  alert,
  onClose,
  onAddLabelMatcher,
  runbookBaseUrl,
  silences,
  onSelectAlert,
}: AlertDetailPanelProps) {
  const [now, setNow] = useState(Date.now())
  const [historyPageSize, setHistoryPageSize] = useState<10 | 50 | 100>(10)
  const [historyPage, setHistoryPage] = useState(1)
  const [silenceFormTarget, setSilenceFormTarget] = useState<Silence | null>(null)
  const [showNewSilenceForm, setShowNewSilenceForm] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showClaimForm, setShowClaimForm] = useState(false)
  const [showEditNoteForm, setShowEditNoteForm] = useState(false)
  const [editNote, setEditNote] = useState('')
  const [manualClaimName, setManualClaimName] = useState(() => localStorage.getItem(USERNAME_KEY) ?? '')
  const [claimNote, setClaimNote] = useState('')
  const { user, providerInfo } = useAuthStore()
  const { guard, loginModalOpen, onLoginSuccess, onLoginClose } = useLoginGuard()
  const theme = useSettingsStore((s) => s.theme)
  const authMode = providerInfo?.mode ?? 'none'
  const claimName = user?.username ?? manualClaimName
  const [promptCopied, setPromptCopied] = useState(false)
  const fmtTime = useFormatTime()

  const historyOffset = (historyPage - 1) * historyPageSize
  const { data: timelineData } = useAlertTimeline(
    alert?.fingerprint ?? '',
    alert?.clusterName ?? '',
    historyPageSize,
    historyOffset,
  )
  const { data: stats } = useAlertStats(alert?.fingerprint ?? '', alert?.clusterName)
  const { data: activeClaim } = useActiveClaim(alert?.fingerprint ?? '', alert?.clusterName ?? '')
  const {
    setClaimMutation,
    releaseMutation,
    updateNoteMutation,
    isOwner,
    claim: submitClaim,
    release: releaseClaim,
    updateNote,
  } = useClaimController(alert?.fingerprint ?? '', alert?.clusterName ?? '')
  const { mutate: deleteSilence } = useDeleteSilence()
  const { mutate: upsertSilence, isPending: isExtending } = useUpsertSilence()
  const { data: allAlerts = [] } = useAlerts()
  const qc = useQueryClient()

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    setHistoryPage(1)
  }, [alert?.fingerprint, alert?.clusterName])

  useEffect(() => {
    if (!timelineData) return
    const totalPages = Math.max(1, Math.ceil(timelineData.total / historyPageSize))
    if (historyPage > totalPages) {
      setHistoryPage(totalPages)
    }
  }, [timelineData, historyPage, historyPageSize])

  if (!alert) return null

  const alertname = alert.labels['alertname'] ?? 'Unknown'
  const severity = alert.labels['severity'] ?? 'none'
  const linkButtons = extractLinkButtons(alert.labels, alert.annotations, runbookBaseUrl)

  const FIFTEEN_MIN = 15 * 60 * 1000

  const activeSilences = alert.status.silencedBy
    .map((id) => silences.find((s) => s.id === id))
    .filter((s): s is Silence => s !== undefined)

  // Only show expired silences when no active/pending silence covers the alert.
  // Alertmanager creates a new ID on every edit (expires the old one), so showing
  // expired entries alongside an active one would always show the predecessor.
  const expiredSilences = activeSilences.length === 0
    ? silences
        .filter(
          (s) =>
            s.status.state === 'expired' &&
            s.clusterName === alert.clusterName &&
            silenceMatchesAlert(s, alert),
        )
        .sort((a, b) => new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime())
        .slice(0, 1)
    : []

  const handleDelete = (s: Silence) => {
    setDeletingId(s.id)
    const by = user?.username ?? localStorage.getItem(USERNAME_KEY) ?? 'unknown'
    const snapshot = {
      all: qc.getQueryData<Silence[]>(['silences', undefined]),
      cluster: qc.getQueryData<Silence[]>(['silences', s.clusterName]),
    }
    qc.setQueryData<Silence[]>(['silences', undefined], (old) => old?.filter((x) => x.id !== s.id))
    qc.setQueryData<Silence[]>(['silences', s.clusterName], (old) => old?.filter((x) => x.id !== s.id))
    deleteSilence(
      { id: s.id, cluster: s.clusterName, fingerprint: alert.fingerprint, by },
      {
        onError: () => {
          qc.setQueryData<Silence[]>(['silences', undefined], snapshot.all)
          qc.setQueryData<Silence[]>(['silences', s.clusterName], snapshot.cluster)
        },
        onSettled: () => setDeletingId(null),
      },
    )
  }

  const labelEntries = Object.entries(alert.labels)
  const half = Math.ceil(labelEntries.length / 2)
  const leftLabels = labelEntries.slice(0, half)
  const rightLabels = labelEntries.slice(half)

  const renderLabelColumn = (labels: [string, string][]) =>
    labels.map(([k, v]) => (
      <div key={k} data-testid="detail-label-item" className="flex flex-col gap-0.5">
        <span
          className="cursor-pointer font-mono text-[10px] text-muted-foreground hover:text-foreground"
          title="Add as filter"
          onClick={() => onAddLabelMatcher({ name: k, operator: '=', value: v })}
        >
          {k}
        </span>
        <span className="break-all text-xs">{v}</span>
      </div>
    ))

  const summaryText = alert.annotations['summary']
  const descriptionText = alert.annotations['description']
  const linkButtonKeys = new Set(linkButtons.map((b) => b.label))
  const annotationEntries = Object.entries(alert.annotations).filter(
    ([k]) => k !== 'summary' && k !== 'description' && !linkButtonKeys.has(k),
  )
  const promptHistoryRows = (timelineData?.entries ?? []).map((entry) => ({
    time: new Date(entry.recordedAt),
    who: entry.who,
    action: toHistoryAction(entry.source, entry.action),
    comment: entry.comment || undefined,
  }))
  const promptTotalRows = timelineData?.total ?? 0
  const promptTotalPages = Math.max(1, Math.ceil(promptTotalRows / historyPageSize))
  const promptSafePage = Math.min(historyPage, promptTotalPages)
  const promptCacheKey = JSON.stringify({
    fingerprint: alert.fingerprint,
    historyPageSize,
    historyPage,
    timelineTotal: promptTotalRows,
    timelineEntries: timelineData?.entries ?? [],
    stats: stats ?? null,
    labels: alert.labels,
    annotations: annotationEntries,
    status: alert.status.state,
    severity,
    alertname,
  })
  const promptText = getCachedPrompt(promptCacheKey, () => {
    const lines: string[] = []
    lines.push('You are an experienced Site Reliability Engineer (SRE). Analyze the following Prometheus alert and help with root cause analysis and remediation.')
    lines.push('')
    lines.push(`## Alert: ${alertname}`)
    lines.push(`- **Cluster**: ${alert.clusterName}`)
    lines.push(`- **Severity**: ${severity}`)
    lines.push(`- **Status**: ${alert.status.state}`)
    if (stats) {
      lines.push(`- **First seen**: ${format(new Date(stats.firstSeenAt), 'yyyy-MM-dd HH:mm', { locale: enUS })}`)
      lines.push(`- **Occurrences**: ${stats.occurrenceCount}`)
    }
    lines.push('')
    lines.push('## Labels')
    for (const [k, v] of Object.entries(alert.labels)) {
      lines.push(`- **${k}**: ${v}`)
    }
    if (annotationEntries.length > 0) {
      lines.push('')
      lines.push('## Annotations')
      for (const [k, v] of annotationEntries) {
        lines.push(`- **${k}**: ${v}`)
      }
    }
    lines.push('')
    lines.push(`## History (${promptTotalRows} entries, page ${promptSafePage}/${promptTotalPages})`)
    lines.push('| Time | Who | Action | Comment |')
    lines.push('|------|-----|--------|---------|')
    for (const r of promptHistoryRows) {
      const t = format(r.time, 'yyyy-MM-dd HH:mm', { locale: enUS })
      lines.push(`| ${t} | ${r.who} | ${r.action} | ${r.comment ?? '—'} |`)
    }
    lines.push('')
    lines.push('## Tasks')
    lines.push('1. What is the most likely cause of this alert?')
    lines.push('2. What further steps do you recommend for diagnosis?')
    lines.push('3. How can this alert be permanently resolved?')
    return lines.join('\n')
  })

  return (
    <>
      <Sheet open={!!alert} onClose={onClose} testId="detail-panel" closeTestId="detail-panel-close" ariaLabelledby="detail-panel-title">
        {(silenceFormTarget || showNewSilenceForm) && (
          <div className="absolute inset-0 z-10 bg-black/40 pointer-events-none" aria-hidden="true" />
        )}
        {/* Header */}
        <div className="border-b border-border bg-card px-5 py-4 pt-8">
          <div className="flex items-start justify-between gap-3 pr-8">
            <h2 id="detail-panel-title" className="text-lg font-bold break-all">{alertname}</h2>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-2 py-0.5 text-xs font-medium">
                <Server className="h-3 w-3 text-muted-foreground" />
                {alert.clusterName}
              </span>
              <AlertBadge severity={severity} />
              <StatusBadge state={alert.status.state} />
            </div>
          </div>
          <div data-testid="detail-stats-section" className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            {stats ? (
              <>
                <span data-testid="stat-last-fired">
                  Last fired <span className="font-medium text-foreground">{fmtTime(stats.lastFiredAt ?? stats.lastSeenAt)}</span>
                </span>
                <span>·</span>
                <span data-testid="stat-occurrence-count">{stats.occurrenceCount}× fired</span>
              </>
            ) : (
              <span>Stats unavailable</span>
            )}
          </div>

          {/* Action buttons */}
          <div className="mt-3 flex items-center justify-between gap-2 pr-8">
            {alert.alertmanagerUrl && (
              <a
                href={(() => {
                  const filter = `{alertname="${alert.labels.alertname}"}`
                  const params = new URLSearchParams({
                    silenced: 'false',
                    inhibited: 'false',
                    muted: 'false',
                    active: 'true',
                    filter,
                  })
                  return `${alert.alertmanagerUrl}/#/alerts?${params.toString()}`
                })()}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent cursor-pointer"
              >
                <ExternalLink className="h-3 w-3" />
                Go to Alertmanager
              </a>
            )}
            <div className="flex shrink-0 items-center gap-2 ml-auto">
              {activeClaim ? (
                <div data-testid="detail-claim-badge" className={cn('flex h-8 min-w-0 max-w-[16rem] items-center gap-1.5 rounded-md border px-2', theme === 'light' ? 'border-blue-300 bg-blue-50' : 'border-blue-800 bg-blue-950/40')}>
                  <User className={cn('h-3 w-3 shrink-0', theme === 'light' ? 'text-blue-600' : 'text-blue-400')} />
                  <span className={cn('shrink-0 text-xs font-medium', theme === 'light' ? 'text-blue-700' : 'text-blue-300')}>{activeClaim.claimedBy}</span>
                  {activeClaim.note && (
                    <Tooltip content={activeClaim.note} wrapperClassName="min-w-0">
                      <span data-testid="detail-claim-note" className={cn('min-w-0 truncate text-xs', theme === 'light' ? 'text-blue-600' : 'text-blue-400/80')}>{activeClaim.note}</span>
                    </Tooltip>
                  )}
                  {isOwner(activeClaim.claimedBy) && (
                    <button
                      data-testid="claim-edit-note-button"
                      title="Edit note"
                      className={cn('ml-1 shrink-0 cursor-pointer', theme === 'light' ? 'text-blue-500 hover:text-blue-700' : 'text-blue-400/70 hover:text-blue-300')}
                      onClick={() => {
                        setEditNote(activeClaim.note ?? '')
                        setShowEditNoteForm((v) => !v)
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                  <button
                    data-testid="claim-release-button"
                    className="ml-1 shrink-0 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={() => guard(() => releaseClaim())}
                    disabled={releaseMutation.isPending}
                  >
                    ✕
                  </button>
                </div>
              ) : alert.status.state === 'resolved' ? null : (
                <div className="relative p-[2px] overflow-hidden rounded-md">
                  <div className="claim-snake-spinner absolute inset-[-150%]" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => guard(() => setShowClaimForm((v) => !v))}
                    className="relative z-10 bg-card border-transparent hover:bg-accent hover:border-transparent"
                  >
                    <User className="h-3.5 w-3.5" />
                    Claim
                  </Button>
                </div>
              )}
              <Button
                size="sm"
                onClick={() => setShowNewSilenceForm(true)}
              >
                <BellOff className="h-3.5 w-3.5" />
                Silence
              </Button>
            </div>
          </div>

          {showEditNoteForm && activeClaim && isOwner(activeClaim.claimedBy) && (
            <form
              data-testid="claim-edit-note-form"
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault()
                guard(() => updateNote(editNote, { onSuccess: () => setShowEditNoteForm(false) }))
              }}
            >
              <textarea
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder="Note"
                rows={5}
                className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" className="h-7 text-xs" disabled={updateNoteMutation.isPending}>
                  Save
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowEditNoteForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {showClaimForm && !activeClaim && alert.status.state !== 'resolved' && (
            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault()
                guard(() => {
                  const currentUser = useAuthStore.getState().user
                  const nameToUse = currentUser?.username ?? manualClaimName
                  submitClaim(
                    { claimedBy: nameToUse, note: claimNote },
                    { onSuccess: () => { setShowClaimForm(false); setClaimNote('') } },
                  )
                })
              }}
            >
              {authMode !== 'none' ? (
                <div className="flex items-center gap-1.5 h-7 px-2 rounded border border-border bg-muted text-xs text-muted-foreground w-48">
                  <User className="h-3 w-3 shrink-0" />
                  <span>{user?.username ?? '…'}</span>
                </div>
              ) : (
                <Input
                  value={manualClaimName}
                  onChange={(e) => setManualClaimName(e.target.value)}
                  placeholder="Your name"
                  className="h-7 w-48 text-xs"
                  required
                />
              )}
              <textarea
                value={claimNote}
                onChange={(e) => setClaimNote(e.target.value)}
                placeholder="Note (optional)"
                rows={5}
                className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" className="h-7 text-xs" disabled={!claimName.trim() || setClaimMutation.isPending}>
                  Confirm
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowClaimForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>


        {/* Active / pending silence banners */}
        {activeSilences.map((s) => {
          const endsAt = new Date(s.endsAt).getTime()
          const remaining = endsAt - now
          const isExpiring = s.status.state === 'active' && remaining <= FIFTEEN_MIN
          const isDeleting = deletingId === s.id
          const isPending = s.status.state === 'pending'

          return (
            <div
              key={s.id}
              className={cn(
                'border-b border-border px-5 py-4',
                isExpiring
                  ? (theme === 'light' ? 'bg-yellow-50' : 'bg-yellow-900/30')
                  : (theme === 'light' ? 'bg-muted' : 'bg-slate-900'),
              )}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className={cn(
                  'flex items-center gap-1.5 text-xs font-semibold',
                  isPending
                    ? 'text-muted-foreground'
                    : isExpiring
                      ? (theme === 'light' ? 'text-yellow-700' : 'text-yellow-300')
                      : 'text-foreground',
                )}>
                  <BellOff className="h-3 w-3 shrink-0" />
                  {isPending ? 'Silence pending' : 'Silence active'}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {isExpiring && (
                    <>
                      {([
                        { label: '+1h', ms: 60 * 60_000 },
                        { label: '+4h', ms: 4 * 60 * 60_000 },
                        { label: '+1d', ms: 24 * 60 * 60_000 },
                      ] as const).map(({ label, ms }) => (
                        <button
                          key={label}
                          disabled={isExtending}
                          className="flex items-center gap-1 rounded border border-yellow-700 px-2 py-0.5 text-xs text-yellow-300 hover:bg-yellow-900/50 cursor-pointer disabled:opacity-40"
                          onClick={() => guard(() => upsertSilence({
                            id: s.id,
                            cluster: s.clusterName,
                            matchers: s.matchers,
                            startsAt: s.startsAt,
                            endsAt: new Date(new Date(s.endsAt).getTime() + ms).toISOString(),
                            createdBy: s.createdBy,
                            comment: s.comment,
                            fingerprint: alert.fingerprint,
                            performedBy: useAuthStore.getState().user?.username ?? localStorage.getItem(USERNAME_KEY) ?? 'unknown',
                          }))}
                        >
                          {label}
                        </button>
                      ))}
                    </>
                  )}
                  <button
                    className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
                    onClick={() => setSilenceFormTarget(s)}
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </button>
                  <button
                    disabled={isDeleting}
                    className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-red-500/70 hover:text-red-400 hover:bg-red-950/40 cursor-pointer disabled:opacity-40"
                    onClick={() => guard(() => handleDelete(s))}
                  >
                    <Trash2 className="h-3 w-3" />
                    {isDeleting ? '…' : 'Expire'}
                  </button>
                </div>
              </div>

              <div className="flex gap-5 overflow-hidden">
                <div className="w-[55%] shrink-0 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs self-start">
                  <span className="text-muted-foreground">Silence ID</span>
                  <a
                    href={`${s.alertmanagerUrl}/#/silences/${s.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-muted-foreground truncate hover:text-foreground underline decoration-dotted"
                  >
                    {s.id}
                  </a>

                  <span className="text-muted-foreground">Created by</span>
                  <span className={isExpiring ? (theme === 'light' ? 'text-yellow-800' : 'text-yellow-200') : 'text-foreground'}>{s.createdBy}</span>

                  <span className="text-muted-foreground">Created at</span>
                  <span className={isExpiring ? (theme === 'light' ? 'text-yellow-700' : 'text-yellow-400') : 'text-muted-foreground'}>
                    {format(new Date(s.updatedAt), 'yyyy-MM-dd HH:mm', { locale: enUS })} {tzAbbr}
                  </span>

                  {isPending ? (
                    <>
                      <span className="text-muted-foreground">Starts at</span>
                      <span className="text-muted-foreground">
                        {format(new Date(s.startsAt), 'yyyy-MM-dd HH:mm', { locale: enUS })} {tzAbbr}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-muted-foreground">{isExpiring ? 'Expires' : 'Ends'}</span>
                      <span className={isExpiring ? (theme === 'light' ? 'text-yellow-700' : 'text-yellow-400') : 'text-muted-foreground'}>
                        in {formatDuration(remaining)} ({format(new Date(s.endsAt), 'yyyy-MM-dd HH:mm', { locale: enUS })} {tzAbbr})
                      </span>
                    </>
                  )}

                  {s.comment && (
                    <>
                      <span className="text-muted-foreground">Reason</span>
                      <span className={isExpiring ? (theme === 'light' ? 'text-yellow-700' : 'text-yellow-400') : 'text-muted-foreground'}>{s.comment}</span>
                    </>
                  )}
                </div>

                <div className="flex flex-1 min-w-0 flex-wrap content-start gap-1">
                  {s.matchers.map((m, i) => <MatcherChip key={i} matcher={m} />)}
                </div>
              </div>

              {(() => {
                const affected = allAlerts.filter((a) => a.status.silencedBy.includes(s.id))
                if (affected.length === 0) return null

                return (
                  <AffectedAlertsSection
                    affected={affected}
                    currentAlert={alert}
                    onSelectAlert={onSelectAlert}
                  />
                )
              })()}
            </div>
          )
        })}

        {/* Expired silence banners */}
        {expiredSilences.map((s) => (
          <div key={s.id} className={cn('border-b border-border px-5 py-4', theme === 'light' ? 'bg-muted' : 'bg-slate-950')}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <BellOff className="h-3 w-3 shrink-0" />
                Silence expired
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
                  onClick={() => setSilenceFormTarget(s)}
                >
                  Recreate
                </button>
              </div>
            </div>

            <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-xs">
              <span className="text-muted-foreground">Silence ID</span>
              <a
                href={`${s.alertmanagerUrl}/#/silences/${s.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-muted-foreground truncate hover:text-foreground underline decoration-dotted"
              >
                {s.id}
              </a>

              <span className="text-muted-foreground">Created by</span>
              <span className="text-muted-foreground">{s.createdBy}</span>

              <span className="text-muted-foreground">Created at</span>
              <span className="text-muted-foreground">
                {format(new Date(s.updatedAt), 'yyyy-MM-dd HH:mm', { locale: enUS })} {tzAbbr}
              </span>

              <span className="text-muted-foreground">Expired at</span>
              <span className="text-muted-foreground">
                {format(new Date(s.endsAt), 'yyyy-MM-dd HH:mm', { locale: enUS })} {tzAbbr}
              </span>

              {s.comment && (
                <>
                  <span className="text-muted-foreground">Reason</span>
                  <span className="text-muted-foreground">{s.comment}</span>
                </>
              )}
            </div>

          </div>
        ))}

        {/* Annotations */}
        {annotationEntries.length > 0 && (
          <AlertDetailSection title="Annotations" defaultOpen={true} testId="detail-annotations-section">
            <div className="space-y-1 text-xs">
              {annotationEntries.map(([k, v]) => (
                <div key={k} data-testid="detail-annotation-item" className="flex gap-2">
                  <span className="font-mono text-muted-foreground">{k}</span>
                  <span data-testid="detail-annotation-value" className="break-all">{v}</span>
                </div>
              ))}
            </div>
          </AlertDetailSection>
        )}

        {/* Summary / Description */}
        {(summaryText || descriptionText) && (
          <AlertDetailSection title="Summary" defaultOpen={true}>
            <div className="space-y-2">
              {summaryText && (
                <p className="text-sm text-foreground">{renderTextWithLinks(summaryText)}</p>
              )}
              {descriptionText && (
                <p className="text-xs text-muted-foreground leading-relaxed">{renderTextWithLinks(descriptionText)}</p>
              )}
            </div>
          </AlertDetailSection>
        )}

        {/* Links */}
        {linkButtons.length > 0 && (
          <AlertDetailSection
            title={
              <>
                Links
                <span
                  className="group relative inline-flex items-center"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
                  <span className="pointer-events-none absolute left-0 top-5 z-50 w-72 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg opacity-0 group-hover:opacity-100 transition-opacity normal-case tracking-normal font-normal leading-relaxed">
                    Links are auto-generated from labels and annotations whose value is an absolute URL (http:// or https://).
                    <br /><br />
                    The <code className="rounded bg-accent px-0.5 font-mono">runbook</code> key also accepts a plain ID — set{' '}
                    <code className="rounded bg-accent px-0.5 font-mono">JARVIS_RUNBOOK_BASE_URL</code> to build the full URL automatically.
                  </span>
                </span>
              </>
            }
            defaultOpen={true}
          >
            <div className="flex flex-wrap items-center gap-2">
              {linkButtons.map((btn) => (
                <a
                  key={btn.label}
                  href={btn.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent cursor-pointer"
                >
                  {btn.isRunbook ? <BookOpen className="h-3 w-3" /> : <ExternalLink className="h-3 w-3" />}
                  <span className="first-letter:uppercase">{btn.label}</span>
                </a>
              ))}
            </div>
          </AlertDetailSection>
        )}

        {/* Labels */}
        <AlertDetailSection title="Labels" testId="detail-labels-section">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div className="space-y-2">{renderLabelColumn(leftLabels)}</div>
            <div className="space-y-2">{renderLabelColumn(rightLabels)}</div>
          </div>
          {alert.seenOn && alert.seenOn.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3" data-testid="detail-seen-on">
              <span className="text-xs text-muted-foreground">seen on:</span>
              {alert.seenOn.map((member) => (
                <span key={member} className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {member}
                </span>
              ))}
            </div>
          )}
        </AlertDetailSection>

        {/* History */}
        <AlertDetailHistorySection
          timelineData={timelineData}
          historyPage={historyPage}
          historyPageSize={historyPageSize}
          setHistoryPage={setHistoryPage}
          setHistoryPageSize={setHistoryPageSize}
          alertmanagerUrl={alert.alertmanagerUrl}
          promptText={promptText}
          promptCopied={promptCopied}
          setPromptCopied={setPromptCopied}
        />

        {/* Comments */}
        <AlertDetailSection title="Comments" testId="detail-comments-section">
          <AlertComments fingerprint={alert.fingerprint} clusterName={alert.clusterName} />
        </AlertDetailSection>

      </Sheet>

      {/* Silence form sheet (new silence for this alert) */}
      {showNewSilenceForm && (
        <Sheet
          open={true}
          onClose={() => setShowNewSilenceForm(false)}
          className="sm:max-w-2xl lg:max-w-3xl"
        >
          <div className="p-5 pt-10">
            <h2 className="mb-4 text-base font-semibold">Create new silence</h2>
            <SilenceForm
              availableClusters={[alert.clusterName]}
              prefillAlerts={[alert]}
              fingerprint={alert.fingerprint}
              onSuccess={() => setShowNewSilenceForm(false)}
              onCancel={() => setShowNewSilenceForm(false)}
            />
          </div>
        </Sheet>
      )}

      {/* Silence form sheet (edit / recreate) */}
      {silenceFormTarget && (
        <Sheet
          open={true}
          onClose={() => setSilenceFormTarget(null)}
          className="sm:max-w-2xl lg:max-w-3xl"
        >
          <div className="p-5 pt-10">
            <h2 className="mb-4 text-base font-semibold">
              {silenceFormTarget.status.state === 'expired' ? 'Recreate silence' : 'Edit silence'}
            </h2>
            <SilenceForm
              availableClusters={[silenceFormTarget.clusterName]}
              prefillSilence={silenceFormTarget}
              isRecreate={silenceFormTarget.status.state === 'expired'}
              fingerprint={alert.fingerprint}
              onSuccess={() => setSilenceFormTarget(null)}
              onCancel={() => setSilenceFormTarget(null)}
            />
          </div>
        </Sheet>
      )}
      <LoginModal open={loginModalOpen} onSuccess={onLoginSuccess} onClose={onLoginClose} />
    </>
  )
}
