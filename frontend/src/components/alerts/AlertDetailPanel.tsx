import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { ExternalLink, BookOpen, ChevronDown, ChevronUp, BellOff, Pencil, Trash2, User, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sheet } from '@/components/ui/sheet'
import { AlertBadge, StatusBadge } from './AlertBadge'
import { labelColorStyle } from './LabelChip'
import { AlertComments } from './AlertComments'
import { SilenceForm } from '@/components/silences/SilenceForm'
import { useAlerts, useAlertHistory, useAlertStats } from '@/hooks/useAlerts'
import { useActiveClaim, useSetClaim, useReleaseClaim, useClaimHistory } from '@/hooks/useAlertClaim'
import { useDeleteSilence, useSilenceEvents, useUpsertSilence } from '@/hooks/useSilences'
import { useAuthStore } from '@/store/authStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { EnrichedAlert, LabelMatcher, Silence, SilenceMatcher } from '@/types'
import { renderTextWithLinks } from '@/lib/linkUtils'
import { tzAbbr } from '@/lib/alertUtils'

const USERNAME_KEY = 'jarvis-username'

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
    <span
      className="rounded border px-1.5 py-0.5 text-[10px] font-medium"
      style={labelColorStyle(matcher.name, theme)}
    >
      {matcher.name}{matcherOp(matcher)}{matcher.value}
    </span>
  )
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({
  title,
  children,
  defaultOpen = true,
  headerRight,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  headerRight?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-border py-4 px-5">
      <button
        className="flex w-full items-center justify-between text-sm font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        {title}
        <div className="flex items-center gap-2">
          {headerRight && (
            <span onClick={(e) => e.stopPropagation()}>{headerRight}</span>
          )}
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      </button>
      {open && <div className="mt-3">{children}</div>}
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
}

export function AlertDetailPanel({
  alert,
  onClose,
  onAddLabelMatcher,
  runbookBaseUrl,
  silences,
}: AlertDetailPanelProps) {
  const [now, setNow] = useState(Date.now())
  const [historyPageSize, setHistoryPageSize] = useState<10 | 50 | 100>(10)
  const [historyPage, setHistoryPage] = useState(1)
  const [silenceFormTarget, setSilenceFormTarget] = useState<Silence | null>(null)
  const [showNewSilenceForm, setShowNewSilenceForm] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showClaimForm, setShowClaimForm] = useState(false)
  const [manualClaimName, setManualClaimName] = useState(() => localStorage.getItem(USERNAME_KEY) ?? '')
  const [claimNote, setClaimNote] = useState('')
  const { user, providerInfo } = useAuthStore()
  const theme = useSettingsStore((s) => s.theme)
  const authMode = providerInfo?.mode ?? 'none'
  const claimName = user?.username ?? manualClaimName
  const [promptCopied, setPromptCopied] = useState(false)

  const { data: historyData } = useAlertHistory(
    alert?.fingerprint ?? '',
    1000,
  )
  const { data: stats } = useAlertStats(alert?.fingerprint ?? '')
  const { data: activeClaim } = useActiveClaim(alert?.fingerprint ?? '')
  const setClaimMutation = useSetClaim(alert?.fingerprint ?? '')
  const releaseMutation = useReleaseClaim(alert?.fingerprint ?? '')
  const { data: claimHistory = [] } = useClaimHistory(alert?.fingerprint ?? '')
  const { data: silenceHistory = [] } = useSilenceEvents(alert?.fingerprint ?? '')
  const { mutate: deleteSilence } = useDeleteSilence()
  const { mutate: upsertSilence, isPending: isExtending } = useUpsertSilence()
  const { data: allAlerts = [] } = useAlerts()
  const qc = useQueryClient()

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  if (!alert) return null

  const alertname = alert.labels['alertname'] ?? 'Unknown'
  const severity = alert.labels['severity'] ?? 'none'
  const runbookRaw = alert.labels['runbook'] ?? alert.annotations['runbook']
  const runbookUrl = runbookRaw
    ? runbookBaseUrl
      ? `${runbookBaseUrl}${runbookRaw}`
      : runbookRaw.startsWith('http://') || runbookRaw.startsWith('https://')
        ? runbookRaw
        : null
    : null
  const dashboardAnnotation = alert.annotations['dashboard']

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
      <div key={k} className="flex flex-col gap-0.5">
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
  const linkAnnotation = alert.annotations['link']
  const annotationEntries = Object.entries(alert.annotations).filter(
    ([k]) => k !== 'summary' && k !== 'description' && k !== 'dashboard' && k !== 'link',
  )

  return (
    <>
      <Sheet open={!!alert} onClose={onClose}>
        {(silenceFormTarget || showNewSilenceForm) && (
          <div className="absolute inset-0 z-10 bg-black/40 pointer-events-none" aria-hidden="true" />
        )}
        {/* Header */}
        <div className="border-b border-border bg-card px-5 py-4 pt-8">
          <div className="flex items-start justify-between gap-3 pr-8">
            <h2 className="text-lg font-bold break-all">{alertname}</h2>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              <span className="rounded bg-accent px-2 py-0.5 text-xs">{alert.clusterName}</span>
              <AlertBadge severity={severity} />
              <StatusBadge state={alert.status.state} />
            </div>
          </div>
          {stats && (
            <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
              <span>First seen <span className="font-medium text-foreground">{formatDistanceToNow(new Date(stats.firstSeenAt), { addSuffix: true, locale: enUS })}</span></span>
              <span>·</span>
              <span>{stats.occurrenceCount}× fired</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-3 flex items-center justify-end gap-2 pr-8">
            <div className="flex shrink-0 items-center gap-2">
              {activeClaim ? (
                <div className={cn('flex items-center gap-1.5 rounded border px-2 py-1', theme === 'light' ? 'border-blue-300 bg-blue-50' : 'border-blue-800 bg-blue-950/40')}>
                  <User className={cn('h-3 w-3 shrink-0', theme === 'light' ? 'text-blue-600' : 'text-blue-400')} />
                  <span className={cn('text-xs font-medium', theme === 'light' ? 'text-blue-700' : 'text-blue-300')}>{activeClaim.claimedBy}</span>
                  <button
                    className="ml-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={() => releaseMutation.mutate(user?.username ?? localStorage.getItem(USERNAME_KEY) ?? 'unknown')}
                    disabled={releaseMutation.isPending}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent cursor-pointer"
                  onClick={() => setShowClaimForm((v) => !v)}
                >
                  <User className="h-3 w-3" />
                  Claim
                </button>
              )}
              <button
                className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent cursor-pointer"
                onClick={() => setShowNewSilenceForm(true)}
              >
                <BellOff className="h-3 w-3" />
                Silence
              </button>
            </div>
          </div>

          {showClaimForm && !activeClaim && (
            authMode !== 'none' && !user ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Login required to claim this alert.
              </p>
            ) : (
            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!claimName.trim()) return
                if (authMode === 'none') localStorage.setItem(USERNAME_KEY, claimName.trim())
                setClaimMutation.mutate(
                  { claimedBy: claimName.trim(), note: claimNote.trim() || undefined },
                  { onSuccess: () => { setShowClaimForm(false); setClaimNote('') } },
                )
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
            )
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
                          onClick={() => upsertSilence({
                            id: s.id,
                            cluster: s.clusterName,
                            matchers: s.matchers,
                            startsAt: s.startsAt,
                            endsAt: new Date(new Date(s.endsAt).getTime() + ms).toISOString(),
                            createdBy: s.createdBy,
                            comment: s.comment,
                            fingerprint: alert.fingerprint,
                            performedBy: user?.username ?? localStorage.getItem(USERNAME_KEY) ?? 'unknown',
                          })}
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
                    onClick={() => handleDelete(s)}
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
                  <div className="mt-2">
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
          <Section title="Annotations" defaultOpen={true}>
            <div className="space-y-1 text-xs">
              {annotationEntries.map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="font-mono text-muted-foreground">{k}</span>
                  <span className="break-all">{v}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Summary / Description */}
        {(summaryText || descriptionText || alert.alertmanagerUrl || dashboardAnnotation || linkAnnotation || runbookUrl) && (
          <Section title="Summary" defaultOpen={true}>
            <div className="space-y-2">
              {summaryText && (
                <p className="text-sm text-foreground">{renderTextWithLinks(summaryText)}</p>
              )}
              {descriptionText && (
                <p className="text-xs text-muted-foreground leading-relaxed">{renderTextWithLinks(descriptionText)}</p>
              )}
              {(alert.alertmanagerUrl || dashboardAnnotation || linkAnnotation || runbookUrl) && (
                <div className="flex flex-wrap gap-2 pt-1">
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
                      Alertmanager
                    </a>
                  )}
                  {dashboardAnnotation && (
                    <a
                      href={dashboardAnnotation}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent cursor-pointer"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Dashboard
                    </a>
                  )}
                  {linkAnnotation && (
                    <a
                      href={linkAnnotation}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent cursor-pointer"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Link
                    </a>
                  )}
                  {runbookUrl && (
                    <a
                      href={runbookUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent cursor-pointer"
                    >
                      <BookOpen className="h-3 w-3" />
                      Runbook
                    </a>
                  )}
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Labels */}
        <Section title="Labels">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div className="space-y-2">{renderLabelColumn(leftLabels)}</div>
            <div className="space-y-2">{renderLabelColumn(rightLabels)}</div>
          </div>
        </Section>

        {/* History */}
        {(() => {
          type HistoryRow = { key: string; time: Date; who: string; action: string; comment?: string; silenceId?: string; alertmanagerUrl?: string }

          const alertEventLabel: Record<string, string> = {
            firing: 'Alert fired',
            suppressed: 'Alert suppressed',
            expired: 'Silence expired',
            resolved: 'Alert resolved',
          }

          const silenceActionLabel: Record<string, string> = {
            pending: 'Silence pending',
            created: 'Silence created',
            updated: 'Silence updated',
            deleted: 'Silence deleted',
            expired: 'Silence expired',
          }

          const actionColor: Record<string, string> = theme === 'light' ? {
            'Alert fired': 'text-red-600',
            'Alert resolved': 'text-green-600',
            'Alert suppressed': 'text-muted-foreground',
            'Silence expired': 'text-yellow-600',
            claimed: 'text-blue-600',
            unclaimed: 'text-muted-foreground',
            'Silence pending': 'text-muted-foreground',
            'Silence created': 'text-muted-foreground',
            'Silence updated': 'text-muted-foreground',
            'Silence deleted': 'text-orange-600',
          } : {
            'Alert fired': 'text-red-400',
            'Alert resolved': 'text-green-400',
            'Alert suppressed': 'text-slate-400',
            'Silence expired': 'text-yellow-400',
            claimed: 'text-blue-400',
            unclaimed: 'text-muted-foreground',
            'Silence pending': 'text-slate-300',
            'Silence created': 'text-slate-300',
            'Silence updated': 'text-slate-300',
            'Silence deleted': 'text-orange-400',
          }

          const allRows: HistoryRow[] = []

          if (historyData) {
            for (const e of historyData.events) {
              allRows.push({
                key: `event-${e.id}`,
                time: new Date(e.recordedAt),
                who: 'system',
                action: alertEventLabel[e.status] ?? e.status,
              })
            }
          }

          for (const c of claimHistory) {
            allRows.push({
              key: `claim-${c.id}`,
              time: new Date(c.claimedAt),
              who: c.claimedBy,
              action: 'claimed',
              comment: c.note || undefined,
            })
            if (c.releasedAt) {
              allRows.push({
                key: `release-${c.id}`,
                time: new Date(c.releasedAt),
                who: c.releasedBy ?? 'system',
                action: 'unclaimed',
                comment: c.releaseReason ?? undefined,
              })
            }
          }

          for (const se of silenceHistory) {
            allRows.push({
              key: `silence-${se.id}`,
              time: new Date(se.recordedAt),
              who: se.performedBy,
              action: silenceActionLabel[se.action] ?? `Silence ${se.action}`,
              comment: se.comment || undefined,
              silenceId: se.silenceId,
              alertmanagerUrl: alert.alertmanagerUrl,
            })
          }

          allRows.sort((a, b) => b.time.getTime() - a.time.getTime())

          const totalRows = allRows.length
          const totalPages = Math.max(1, Math.ceil(totalRows / historyPageSize))
          const safePage = Math.min(historyPage, totalPages)
          const pagedRows = allRows.slice((safePage - 1) * historyPageSize, safePage * historyPageSize)

          const pageSizeButtons = (
            <div className="flex items-center gap-1">
              {([10, 50, 100] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => { setHistoryPageSize(n); setHistoryPage(1) }}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-medium cursor-pointer',
                    historyPageSize === n
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          )

          const pageWindow: (number | '…')[] = (() => {
            if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
            const pages: (number | '…')[] = [1]
            if (safePage > 3) pages.push('…')
            for (let p = Math.max(2, safePage - 1); p <= Math.min(totalPages - 1, safePage + 1); p++) pages.push(p)
            if (safePage < totalPages - 2) pages.push('…')
            pages.push(totalPages)
            return pages
          })()

          const buildPrompt = (): string => {
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
            lines.push(`## History (${allRows.length} entries)`)
            lines.push('| Time | Who | Action | Comment |')
            lines.push('|------|-----|--------|---------|')
            for (const r of allRows) {
              const t = format(r.time, 'yyyy-MM-dd HH:mm', { locale: enUS })
              lines.push(`| ${t} | ${r.who} | ${r.action} | ${r.comment ?? '—'} |`)
            }
            lines.push('')
            lines.push('## Tasks')
            lines.push('1. What is the most likely cause of this alert?')
            lines.push('2. What further steps do you recommend for diagnosis?')
            lines.push('3. How can this alert be permanently resolved?')
            return lines.join('\n')
          }

          return (
            <>
            <Section title="History" defaultOpen={true} headerRight={pageSizeButtons}>
              {!historyData ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : (
                <div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-accent/30">
                          <th className="px-3 py-2 text-left text-muted-foreground">Time</th>
                          <th className="px-3 py-2 text-left text-muted-foreground">Who</th>
                          <th className="px-3 py-2 text-left text-muted-foreground">Action</th>
                          <th className="px-3 py-2 text-left text-muted-foreground">Comment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedRows.map((r) => (
                          <tr key={r.key} className="border-b border-border last:border-0">
                            <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                              {format(r.time, 'yyyy-MM-dd HH:mm', { locale: enUS })} {tzAbbr}
                            </td>
                            <td className="px-3 py-2 font-medium">{r.who}</td>
                            <td className={`px-3 py-2 font-medium ${actionColor[r.action] ?? 'text-foreground'}`}>
                              {r.action}
                              {r.silenceId && (
                                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                                  {r.alertmanagerUrl ? (
                                    <a
                                      href={`${r.alertmanagerUrl}/#/silences/${r.silenceId}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="underline underline-offset-2 hover:text-foreground"
                                    >
                                      {r.silenceId}
                                    </a>
                                  ) : (
                                    r.silenceId
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{r.comment ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {totalPages > 1 && (
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted-foreground">
                        {(safePage - 1) * historyPageSize + 1}–{Math.min(safePage * historyPageSize, totalRows)} of {totalRows}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          disabled={safePage === 1}
                          onClick={() => setHistoryPage((p) => p - 1)}
                          className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-default cursor-pointer"
                        >
                          ‹
                        </button>
                        {pageWindow.map((p, i) =>
                          p === '…' ? (
                            <span key={`ellipsis-${i}`} className="px-1 text-[10px] text-muted-foreground">…</span>
                          ) : (
                            <button
                              key={p}
                              onClick={() => setHistoryPage(p)}
                              className={cn(
                                'rounded px-1.5 py-0.5 text-[10px] cursor-pointer',
                                safePage === p
                                  ? 'bg-accent text-foreground font-medium'
                                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                              )}
                            >
                              {p}
                            </button>
                          )
                        )}
                        <button
                          disabled={safePage === totalPages}
                          onClick={() => setHistoryPage((p) => p + 1)}
                          className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-default cursor-pointer"
                        >
                          ›
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Section>
            <Section title="AI Prompt" defaultOpen={false}>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Prompt with alert context for AI analysis</p>
                  <button
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent cursor-pointer"
                    onClick={() => {
                      void navigator.clipboard.writeText(buildPrompt())
                      setPromptCopied(true)
                      setTimeout(() => setPromptCopied(false), 2000)
                    }}
                  >
                    {promptCopied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                    {promptCopied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <pre className="max-h-64 overflow-y-auto rounded bg-accent/30 p-3 text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
                  {buildPrompt()}
                </pre>
              </div>
            </Section>
            </>
          )
        })()}

        {/* Comments */}
        <Section title="Comments">
          <AlertComments fingerprint={alert.fingerprint} />
        </Section>

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
    </>
  )
}
