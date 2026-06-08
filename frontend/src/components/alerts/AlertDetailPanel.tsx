import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'
import { ExternalLink, BookOpen, ChevronDown, ChevronUp, BellOff, Pencil, Trash2, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sheet } from '@/components/ui/sheet'
import { AlertBadge, StatusBadge } from './AlertBadge'
import { AlertComments } from './AlertComments'
import { SilenceForm } from '@/components/silences/SilenceForm'
import { useAlerts, useAlertHistory, useAlertStats } from '@/hooks/useAlerts'
import { useActiveClaim, useSetClaim, useReleaseClaim, useClaimHistory } from '@/hooks/useAlertClaim'
import { useDeleteSilence, useSilenceEvents, useUpsertSilence } from '@/hooks/useSilences'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { EnrichedAlert, LabelMatcher, Silence, SilenceMatcher } from '@/types'

const USERNAME_KEY = 'jarvis-username'

// ── Silence helpers ───────────────────────────────────────────────────────────

function labelColorStyle(key: string) {
  let h = 5381
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0
  const hue = h % 360
  return {
    backgroundColor: `hsl(${hue} 40% 16%)`,
    color: `hsl(${hue} 70% 72%)`,
    borderColor: `hsl(${hue} 35% 30%)`,
  }
}

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
    return remMinutes > 0 ? `${hours} Std. ${remMinutes} Min.` : `${hours} Std.`
  }
  if (minutes >= 1) return `${minutes} Min.`
  return 'wenige Sekunden'
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
  return (
    <span
      className="rounded border px-1.5 py-0.5 text-[10px] font-medium"
      style={labelColorStyle(matcher.name)}
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
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-border py-4 px-5">
      <button
        className="flex w-full items-center justify-between text-sm font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        {title}
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
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
  const [historyLimit, setHistoryLimit] = useState(20)
  const [silenceFormTarget, setSilenceFormTarget] = useState<Silence | null>(null)
  const [showNewSilenceForm, setShowNewSilenceForm] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showClaimForm, setShowClaimForm] = useState(false)
  const [claimName, setClaimName] = useState(() => localStorage.getItem(USERNAME_KEY) ?? '')
  const [claimNote, setClaimNote] = useState('')

  const { data: historyData, isLoading: historyLoading } = useAlertHistory(
    alert?.fingerprint ?? '',
    historyLimit,
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
  const runbookLabel = alert.labels['runbook']
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
    const by = localStorage.getItem(USERNAME_KEY) ?? 'unknown'
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

  const annotationEntries = Object.entries(alert.annotations)

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
              <span>Zuerst gesehen <span className="font-medium text-foreground">{formatDistanceToNow(new Date(stats.firstSeenAt), { addSuffix: true, locale: de })}</span></span>
              <span>·</span>
              <span>{stats.occurrenceCount}× gefeuert</span>
            </div>
          )}

          {/* Links + Claim */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {activeClaim ? (
              <div className="flex items-center gap-1.5 rounded border border-blue-800 bg-blue-950/40 px-2 py-1">
                <User className="h-3 w-3 text-blue-400 shrink-0" />
                <span className="text-xs text-blue-300 font-medium">{activeClaim.claimedBy}</span>
                <button
                  className="ml-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={() => releaseMutation.mutate(localStorage.getItem(USERNAME_KEY) ?? 'unknown')}
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
            {runbookLabel && runbookBaseUrl && (
              <a
                href={`${runbookBaseUrl}${runbookLabel}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent cursor-pointer"
              >
                <BookOpen className="h-3 w-3" />
                Runbook
              </a>
            )}
          </div>

          {showClaimForm && !activeClaim && (
            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!claimName.trim()) return
                localStorage.setItem(USERNAME_KEY, claimName.trim())
                setClaimMutation.mutate(
                  { claimedBy: claimName.trim(), note: claimNote.trim() || undefined },
                  { onSuccess: () => { setShowClaimForm(false); setClaimNote('') } },
                )
              }}
            >
              <Input
                value={claimName}
                onChange={(e) => setClaimName(e.target.value)}
                placeholder="Dein Name"
                className="h-7 w-48 text-xs"
                required
              />
              <textarea
                value={claimNote}
                onChange={(e) => setClaimNote(e.target.value)}
                placeholder="Notiz (optional)"
                rows={5}
                className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" className="h-7 text-xs" disabled={!claimName.trim() || setClaimMutation.isPending}>
                  Bestätigen
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowClaimForm(false)}>
                  Abbrechen
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
                isExpiring ? 'bg-yellow-900/30' : 'bg-slate-900',
              )}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className={cn(
                  'flex items-center gap-1.5 text-xs font-semibold',
                  isPending ? 'text-slate-300' : isExpiring ? 'text-yellow-300' : 'text-slate-200',
                )}>
                  <BellOff className="h-3 w-3 shrink-0" />
                  {isPending ? 'Silence ausstehend' : 'Silence aktiv'}
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
                            performedBy: localStorage.getItem(USERNAME_KEY) ?? 'unknown',
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
                    Bearbeiten
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
                    className="font-mono text-slate-400 truncate hover:text-slate-200 underline decoration-dotted"
                  >
                    {s.id}
                  </a>

                  <span className="text-muted-foreground">Erstellt von</span>
                  <span className={isExpiring ? 'text-yellow-200' : 'text-slate-200'}>{s.createdBy}</span>

                  <span className="text-muted-foreground">Erstellt am</span>
                  <span className={isExpiring ? 'text-yellow-400' : 'text-slate-400'}>
                    {format(new Date(s.updatedAt), 'dd.MM.yyyy HH:mm', { locale: de })} Uhr
                  </span>

                  {isPending ? (
                    <>
                      <span className="text-muted-foreground">Startet am</span>
                      <span className="text-slate-400">
                        {format(new Date(s.startsAt), 'dd.MM.yyyy HH:mm', { locale: de })} Uhr
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-muted-foreground">{isExpiring ? 'Läuft ab' : 'Endet'}</span>
                      <span className={isExpiring ? 'text-yellow-400' : 'text-slate-400'}>
                        in {formatDuration(remaining)} ({format(new Date(s.endsAt), 'dd.MM.yyyy HH:mm', { locale: de })} Uhr)
                      </span>
                    </>
                  )}

                  {s.comment && (
                    <>
                      <span className="text-muted-foreground">Grund</span>
                      <span className={isExpiring ? 'text-yellow-400' : 'text-slate-400'}>{s.comment}</span>
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
                          <span className="font-medium text-slate-300">{a.labels['alertname'] ?? a.fingerprint}</span>
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
          <div key={s.id} className="border-b border-border bg-slate-950 px-5 py-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                <BellOff className="h-3 w-3 shrink-0" />
                Silence abgelaufen
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
                className="font-mono text-slate-600 truncate hover:text-slate-400 underline decoration-dotted"
              >
                {s.id}
              </a>

              <span className="text-muted-foreground">Erstellt von</span>
              <span className="text-slate-600">{s.createdBy}</span>

              <span className="text-muted-foreground">Erstellt am</span>
              <span className="text-slate-700">
                {format(new Date(s.updatedAt), 'dd.MM.yyyy HH:mm', { locale: de })} Uhr
              </span>

              <span className="text-muted-foreground">Abgelaufen am</span>
              <span className="text-slate-700">
                {format(new Date(s.endsAt), 'dd.MM.yyyy HH:mm', { locale: de })} Uhr
              </span>

              {s.comment && (
                <>
                  <span className="text-muted-foreground">Grund</span>
                  <span className="text-slate-700">{s.comment}</span>
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

        {/* Labels */}
        <Section title="Labels">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div className="space-y-2">
              {leftLabels.map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5">
                  <span
                    className="cursor-pointer font-mono text-[10px] text-muted-foreground hover:text-foreground"
                    title="Als Filter hinzufügen"
                    onClick={() => onAddLabelMatcher({ name: k, operator: '=', value: v })}
                  >
                    {k}
                  </span>
                  <span className="break-all text-xs">{v}</span>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {rightLabels.map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5">
                  <span
                    className="cursor-pointer font-mono text-[10px] text-muted-foreground hover:text-foreground"
                    title="Als Filter hinzufügen"
                    onClick={() => onAddLabelMatcher({ name: k, operator: '=', value: v })}
                  >
                    {k}
                  </span>
                  <span className="break-all text-xs">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* History */}
        <Section title="Historie" defaultOpen={true}>
          {!historyData ? (
            <p className="text-xs text-muted-foreground">Laden…</p>
          ) : (() => {
            type HistoryRow = { key: string; time: Date; who: string; action: string; comment?: string; silenceId?: string; alertmanagerUrl?: string }
            const rows: HistoryRow[] = []

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

            const actionColor: Record<string, string> = {
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

            for (const e of historyData.events) {
              rows.push({
                key: `event-${e.id}`,
                time: new Date(e.startsAt),
                who: 'system',
                action: alertEventLabel[e.status] ?? e.status,
              })
            }

            for (const c of claimHistory) {
              rows.push({
                key: `claim-${c.id}`,
                time: new Date(c.claimedAt),
                who: c.claimedBy,
                action: 'claimed',
                comment: c.note || undefined,
              })
              if (c.releasedAt) {
                rows.push({
                  key: `release-${c.id}`,
                  time: new Date(c.releasedAt),
                  who: c.releasedBy ?? 'system',
                  action: 'unclaimed',
                  comment: c.releaseReason ?? undefined,
                })
              }
            }

            for (const se of silenceHistory) {
              rows.push({
                key: `silence-${se.id}`,
                time: new Date(se.recordedAt),
                who: se.performedBy,
                action: silenceActionLabel[se.action] ?? `Silence ${se.action}`,
                comment: se.comment || undefined,
                silenceId: se.silenceId,
                alertmanagerUrl: alert.alertmanagerUrl,
              })
            }

            rows.sort((a, b) => b.time.getTime() - a.time.getTime())

            return (
              <div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-accent/30">
                        <th className="px-3 py-2 text-left text-muted-foreground">Zeit</th>
                        <th className="px-3 py-2 text-left text-muted-foreground">Wer</th>
                        <th className="px-3 py-2 text-left text-muted-foreground">Aktion</th>
                        <th className="px-3 py-2 text-left text-muted-foreground">Kommentar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.key} className="border-b border-border last:border-0">
                          <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                            {format(r.time, 'dd.MM.yyyy HH:mm', { locale: de })}
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
                {historyData.events.length < historyData.total && (
                  <button
                    className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground cursor-pointer py-1"
                    onClick={() => setHistoryLimit((l) => l + 20)}
                    disabled={historyLoading}
                  >
                    Ältere laden ({historyData.total - historyData.events.length} mehr)
                  </button>
                )}
              </div>
            )
          })()}
        </Section>

        {/* Comments */}
        <Section title="Kommentare">
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
            <h2 className="mb-4 text-base font-semibold">Neue Silence erstellen</h2>
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
              {silenceFormTarget.status.state === 'expired' ? 'Silence recreaten' : 'Silence bearbeiten'}
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
