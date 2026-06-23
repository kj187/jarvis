import { Fragment, useState, useEffect } from 'react'
import { ArrowUpDown, Bell, BellMinus, BellOff, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, RefreshCw } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertListRow } from './AlertListRow'
import { EmptyState } from './EmptyState'
import { StatusBadge } from './AlertBadge'
import { HIDDEN_LABEL_KEYS, LabelChip } from './LabelChip'
import { Sheet } from '@/components/ui/sheet'
import { SilenceForm } from '@/components/silences/SilenceForm'
import { SilenceExpireModal } from '@/components/silences/SilenceExpireModal'
import { fetchClusters, deleteSilence } from '@/api/client'
import { formatSilenceDuration, severityOrder } from '@/lib/alertUtils'
import { renderTextWithLinks } from '@/lib/linkUtils'
import { useSettingsStore, RESOLVED_PAGE_SIZE_OPTIONS } from '@/store/useSettingsStore'
import type { EnrichedAlert, Silence } from '@/types'
import { cn } from '@/lib/utils'

interface AlertListViewProps {
  alerts: EnrichedAlert[]
  silences: Silence[]
  onSelectAlert: (fingerprint: string) => void
  selectedFingerprint?: string | null
  stateFilter?: string
  resolvedMode?: boolean
}

interface SilenceSheetState {
  open: boolean
  alerts: EnrichedAlert[]
  prefillSilence?: Silence
  isRecreate?: boolean
}

type SortKey = 'alertname'

interface AlertGroupData {
  alertname: string
  alerts: EnrichedAlert[]
  commonLabels: Record<string, string>
  earliestStart: Date
  clusterNames: string[]
  states: string[]
  claimCount: number
  commonSummary?: string
}

function buildPageWindow(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  if (current <= 4) return [1, 2, 3, 4, 5, '…', total]
  if (current >= total - 3) return [1, '…', total - 4, total - 3, total - 2, total - 1, total]
  return [1, '…', current - 1, current, current + 1, '…', total]
}

const SEVERITY_ORDER = ['critical', 'error', 'warning', 'info', 'none']

const severitySectionConfig: Record<string, { label: string; darkRowClass: string; lightRowClass: string; borderClass: string }> = {
  critical: {
    label: 'Critical',
    darkRowClass: 'text-red-400',
    lightRowClass: 'text-red-700 bg-red-100/80',
    borderClass: 'border-l-red-600',
  },
  error: {
    label: 'Error',
    darkRowClass: 'text-orange-400',
    lightRowClass: 'text-orange-700 bg-orange-100/80',
    borderClass: 'border-l-orange-500',
  },
  warning: {
    label: 'Warning',
    darkRowClass: 'text-yellow-400',
    lightRowClass: 'text-yellow-700 bg-yellow-100/80',
    borderClass: 'border-l-yellow-500',
  },
  info: {
    label: 'Info',
    darkRowClass: 'text-blue-400',
    lightRowClass: 'text-blue-700 bg-blue-100/80',
    borderClass: 'border-l-blue-600',
  },
  none: {
    label: 'None',
    darkRowClass: 'text-slate-400',
    lightRowClass: 'text-slate-600 bg-slate-200/80',
    borderClass: 'border-l-slate-600',
  },
}

interface GroupSilenceInfo {
  active: Array<{ silence: Silence; remaining: number }>
  expiring: Array<{ silence: Silence; remaining: number }>
  expired: Silence[]
}

function getGroupSilenceInfo(
  groupAlerts: EnrichedAlert[],
  alertname: string,
  silences: Silence[],
): GroupSilenceInfo {
  const FIFTEEN_MIN = 15 * 60 * 1000
  const now = Date.now()
  const seen = new Set<string>()
  const active: GroupSilenceInfo['active'] = []
  const expiring: GroupSilenceInfo['expiring'] = []

  for (const alert of groupAlerts) {
    for (const id of alert.status.silencedBy) {
      if (seen.has(id)) continue
      seen.add(id)
      const silence = silences.find((s) => s.id === id)
      if (!silence || silence.status.state !== 'active') continue
      const remaining = new Date(silence.endsAt).getTime() - now
      if (remaining <= FIFTEEN_MIN) expiring.push({ silence, remaining })
      else active.push({ silence, remaining })
    }
  }

  const groupClusterNames = new Set(groupAlerts.map((a) => a.clusterName))
  const expired = silences.filter(
    (s) =>
      s.status.state === 'expired' &&
      groupClusterNames.has(s.clusterName) &&
      s.matchers.some((m) => m.name === 'alertname' && m.isEqual && m.value === alertname),
  )

  return { active, expiring, expired }
}

function buildGroupsBySeverity(alerts: EnrichedAlert[]): Map<string, AlertGroupData[]> {
  const bySeverity = new Map<string, Map<string, EnrichedAlert[]>>()
  for (const alert of alerts) {
    const severity = alert.labels['severity'] ?? 'none'
    const alertname = alert.labels['alertname'] ?? '—'
    if (!bySeverity.has(severity)) bySeverity.set(severity, new Map())
    const byName = bySeverity.get(severity)!
    if (!byName.has(alertname)) byName.set(alertname, [])
    byName.get(alertname)!.push(alert)
  }
  const result = new Map<string, AlertGroupData[]>()
  for (const [severity, byName] of bySeverity) {
    result.set(
      severity,
      Array.from(byName.entries()).map(([alertname, groupAlerts]) => {
        const commonLabels: Record<string, string> = {}
        if (groupAlerts.length > 0) {
          for (const [key, value] of Object.entries(groupAlerts[0].labels)) {
            if (HIDDEN_LABEL_KEYS.has(key) || key.startsWith('__')) continue
            if (groupAlerts.every((a) => a.labels[key] === value)) commonLabels[key] = value
          }
        }
        const firstSummary = groupAlerts[0]?.annotations['summary']
        const commonSummary =
          firstSummary && groupAlerts.every((a) => a.annotations['summary'] === firstSummary)
            ? firstSummary
            : undefined
        return {
          alertname,
          alerts: groupAlerts,
          commonLabels,
          earliestStart: new Date(Math.min(...groupAlerts.map((a) => new Date(a.startsAt).getTime()))),
          clusterNames: [...new Set(groupAlerts.map((a) => a.clusterName))],
          states: [...new Set(groupAlerts.map((a) => a.status.state))],
          claimCount: groupAlerts.filter((a) => a.activeClaim).length,
          commonSummary,
        }
      }),
    )
  }
  return result
}

export function AlertListView({ alerts, silences, onSelectAlert, selectedFingerprint, stateFilter, resolvedMode }: AlertListViewProps) {
  const showStateColumn = !stateFilter
  const [sortKey, setSortKey] = useState<SortKey>('alertname')
  const [sortAsc, setSortAsc] = useState(true)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [silenceSheet, setSilenceSheet] = useState<SilenceSheetState>({ open: false, alerts: [] })
  const [expireTargets, setExpireTargets] = useState<Silence[]>([])
  const resolvedPageSize = useSettingsStore((s) => s.resolvedPageSize)
  const updateSettings = useSettingsStore((s) => s.update)
  const theme = useSettingsStore((s) => s.theme)
  const [resolvedPage, setResolvedPage] = useState(1)

  useEffect(() => {
    setResolvedPage(1)
  }, [resolvedPageSize])

  const qc = useQueryClient()
  const { data: clusters = [] } = useQuery({ queryKey: ['clusters'], queryFn: fetchClusters })
  const clusterNames = clusters.map((c) => c.name)

  const expireMutation = useMutation({
    mutationFn: ({ id, cluster }: { id: string; cluster: string }) => deleteSilence(id, cluster),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['silences'] }),
  })

  function handleExpireConfirm() {
    Promise.all(expireTargets.map((s) => expireMutation.mutateAsync({ id: s.id, cluster: s.clusterName })))
      .finally(() => setExpireTargets([]))
  }

  function openSilenceForm(formAlerts: EnrichedAlert[], prefillSilence?: Silence, isRecreate?: boolean) {
    setSilenceSheet({ open: true, alerts: formAlerts, prefillSilence, isRecreate })
  }
  function closeSilenceForm() {
    setSilenceSheet({ open: false, alerts: [] })
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((v) => !v)
    } else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function sortGroups(groups: AlertGroupData[]): AlertGroupData[] {
    return [...groups].sort((a, b) => {
      const cmp = a.alertname.localeCompare(b.alertname)
      return sortAsc ? cmp : -cmp
    })
  }

  const groupsBySeverity = buildGroupsBySeverity(alerts)
  const presentSeverities = [
    ...SEVERITY_ORDER.filter((s) => groupsBySeverity.has(s)),
    ...[...groupsBySeverity.keys()].filter((s) => !SEVERITY_ORDER.includes(s)),
  ]

  if (alerts.length === 0) {
    return <EmptyState />
  }

  // ── Resolved mode: flat paginated list sorted by endsAt desc ───────────────
  if (resolvedMode) {
    const sorted = [...alerts].sort((a, b) => {
      const timeDiff = new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime()
      if (timeDiff !== 0) return timeDiff
      const sevDiff = severityOrder(a.labels['severity'] ?? 'none') - severityOrder(b.labels['severity'] ?? 'none')
      if (sevDiff !== 0) return sevDiff
      return (a.labels['alertname'] ?? '').localeCompare(b.labels['alertname'] ?? '')
    })

    const totalAlerts = sorted.length
    const totalPages = Math.max(1, Math.ceil(totalAlerts / resolvedPageSize))
    const safePage = Math.min(resolvedPage, totalPages)
    const startIdx = (safePage - 1) * resolvedPageSize
    const endIdx = Math.min(startIdx + resolvedPageSize, totalAlerts)
    const pageAlerts = sorted.slice(startIdx, endIdx)
    const pageWindow = buildPageWindow(safePage, totalPages)

    const pageNavButtons = (
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => setResolvedPage(1)}
          disabled={safePage === 1}
          className="cursor-pointer p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default"
          aria-label="First page"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setResolvedPage((p) => Math.max(1, p - 1))}
          disabled={safePage === 1}
          className="cursor-pointer p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        {pageWindow.map((entry, i) =>
          entry === '…' ? (
            <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted-foreground/50 select-none">…</span>
          ) : (
            <button
              key={entry}
              type="button"
              onClick={() => setResolvedPage(entry as number)}
              className={cn(
                'min-w-[26px] px-1.5 py-0.5 text-xs rounded cursor-pointer transition-colors tabular-nums',
                safePage === entry
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {entry}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => setResolvedPage((p) => Math.min(totalPages, p + 1))}
          disabled={safePage === totalPages}
          className="cursor-pointer p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default"
          aria-label="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setResolvedPage(totalPages)}
          disabled={safePage === totalPages}
          className="cursor-pointer p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default"
          aria-label="Last page"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </button>
      </div>
    )

    return (
      <div>
        {/* ── Top bar: page navigator + count + page size selector ── */}
        <div className="flex items-center gap-3 mb-2">
          {totalAlerts > 0 && pageNavButtons}
          {totalAlerts > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {startIdx + 1}–{endIdx} of {totalAlerts}
            </span>
          )}
          <div className="flex items-center gap-0.5">
            <span className="text-xs text-muted-foreground mr-1.5">Per page:</span>
            {RESOLVED_PAGE_SIZE_OPTIONS.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => updateSettings({ resolvedPageSize: size })}
                className={cn(
                  'px-2.5 py-1 text-xs rounded cursor-pointer transition-colors',
                  resolvedPageSize === size
                    ? 'bg-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Alert Name
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Severity
                </th>
              </tr>
            </thead>
            <tbody>
              {pageAlerts.map((alert) => (
                <AlertListRow
                  key={alert.fingerprint}
                  alert={alert}
                  onClick={onSelectAlert}
                  selected={selectedFingerprint === alert.fingerprint}
                  silences={silences}
                  showStateColumn={false}
                  showSeverityColumn={true}
                  showActionsColumn={false}
                  showClaimColumn={false}
                  noOpacity={true}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Bottom: page navigator + count ── */}
        {totalAlerts > 0 && (
          <div className="flex items-center gap-3 mt-3 px-1">
            {pageNavButtons}
            <span className="text-xs text-muted-foreground tabular-nums">
              {startIdx + 1}–{endIdx} of {totalAlerts}
            </span>
          </div>
        )}

        <Sheet open={silenceSheet.open} onClose={closeSilenceForm} className="sm:max-w-2xl lg:max-w-3xl">
          <div className="p-5 pt-10">
            <h2 className="mb-4 text-base font-semibold">
              {silenceSheet.isRecreate ? 'Extend silence' : 'Create silence'}
            </h2>
            <SilenceForm
              availableClusters={
                clusterNames.length > 0
                  ? clusterNames
                  : [...new Set(silenceSheet.alerts.map((a) => a.clusterName))]
              }
              prefillAlerts={silenceSheet.alerts.length > 0 ? silenceSheet.alerts : undefined}
              prefillSilence={silenceSheet.prefillSilence}
              isRecreate={silenceSheet.isRecreate}
              onSuccess={closeSilenceForm}
              onCancel={closeSilenceForm}
            />
          </div>
        </Sheet>
      </div>
    )
  }

  function SortHeader({ label, sortKeyVal }: { label: string; sortKeyVal: SortKey }) {
    return (
      <th
        className="cursor-pointer select-none px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
        onClick={() => toggleSort(sortKeyVal)}
      >
        <span className="flex items-center gap-1">
          {label}
          <ArrowUpDown
            className={cn('h-3 w-3', sortKey === sortKeyVal ? 'text-foreground' : 'text-muted-foreground/50')}
          />
        </span>
      </th>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <SortHeader label="Alert Name" sortKeyVal="alertname" />
            {showStateColumn && (
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                State
              </th>
            )}
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Actions
            </th>
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Claim
            </th>
          </tr>
        </thead>
        <tbody>
          {presentSeverities.map((severity) => {
            const groups = sortGroups(groupsBySeverity.get(severity)!)
            const cfg = severitySectionConfig[severity] ?? {
              label: severity,
              darkRowClass: 'text-slate-400',
              lightRowClass: 'text-slate-600 bg-slate-200/80',
              borderClass: 'border-l-slate-600',
            }
            const totalAlerts = groups.reduce((sum, g) => sum + g.alerts.length, 0)
            return (
              <Fragment key={severity}>
                <tr aria-hidden="true">
                  <td colSpan={showStateColumn ? 4 : 3} className={cn('h-8 p-0', theme === 'light' ? 'bg-muted' : 'bg-background')} />
                </tr>
                <tr>
                  <td
                    colSpan={showStateColumn ? 4 : 3}
                    className={cn(
                      'border-l-4 px-4 py-2',
                      theme === 'light' ? cfg.lightRowClass : cn(cfg.darkRowClass, 'bg-muted/30'),
                      cfg.borderClass,
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-widest">{cfg.label}</span>
                      <span className="text-xs font-medium opacity-60">{totalAlerts}</span>
                    </span>
                  </td>
                </tr>
                {groups.map((group) => {
                  const groupKey = `${severity}:${group.alertname}`
                  const expanded = expandedGroups.has(groupKey)
                  const stateLabel = group.states.length === 1 ? group.states[0] : 'mixed'
                  const { active: activeSilences, expiring: expiringSilences, expired: expiredSilences } = getGroupSilenceInfo(group.alerts, group.alertname, silences)
                  const hasSilence = activeSilences.length > 0 || expiringSilences.length > 0
                  return (
                    <Fragment key={groupKey}>
                      <tr
                        role="row"
                        tabIndex={0}
                        onClick={() => toggleGroup(groupKey)}
                        onKeyDown={(e) => e.key === 'Enter' && toggleGroup(groupKey)}
                        className={cn(
                          'cursor-pointer transition-colors',
                          theme === 'light'
                            ? 'bg-card hover:bg-accent'
                            : cn('hover:bg-accent/70', expanded ? 'bg-muted/40' : 'bg-muted/30'),
                        )}
                      >
                        <td className={cn('px-4 py-2.5 border-l-4', cfg.borderClass)}>
                          <div className="flex flex-col gap-1">
                            <span className="flex items-center gap-2 font-semibold">
                              {expanded ? (
                                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                              )}
                              {group.alertname}
                              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                {group.alerts.length}
                              </span>
                              {activeSilences.length > 0 && (
                                <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground" title={`Group silenced, ends in ${formatSilenceDuration(activeSilences[0].remaining)}`}>
                                  <BellOff className="h-3 w-3 shrink-0" />
                                  {formatSilenceDuration(activeSilences[0].remaining)}
                                </span>
                              )}
                              {activeSilences.length === 0 && expiringSilences.length > 0 && (
                                <span className={cn('inline-flex items-center gap-1 text-xs font-normal', theme === 'light' ? 'text-amber-600' : 'text-yellow-400')} title={`Group silence expires in ${formatSilenceDuration(expiringSilences[0].remaining)}`}>
                                  <BellOff className="h-3 w-3 shrink-0" />
                                  {formatSilenceDuration(expiringSilences[0].remaining)}
                                </span>
                              )}
                              {!hasSilence && expiredSilences.length > 0 && (
                                <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground/40">
                                  <BellOff className="h-3 w-3 shrink-0" />
                                  expired
                                </span>
                              )}
                            </span>
                            {group.commonSummary && (
                              <span className="pl-6 text-xs text-muted-foreground">{renderTextWithLinks(group.commonSummary)}</span>
                            )}
                            <div className="flex flex-wrap gap-1 pl-6">
                              <LabelChip labelKey="alertname" value={group.alertname} />
                              {group.clusterNames.map((c) => (
                                <LabelChip key={c} labelKey="@cluster" value={c} />
                              ))}
                              {Object.entries(group.commonLabels).map(([key, value]) => (
                                <LabelChip key={key} labelKey={key} value={value} />
                              ))}
                            </div>
                          </div>
                        </td>
                        {showStateColumn && (
                          <td className="px-4 py-2.5">
                            <StatusBadge state={stateLabel} />
                          </td>
                        )}
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-col gap-1">
                            {activeSilences.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setExpireTargets(activeSilences.map(({ silence }) => silence))}
                                title={activeSilences.length > 1 ? `Expire ${activeSilences.length} group silences` : 'Expire group silence'}
                                className="cursor-pointer flex w-fit items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-border/80 hover:text-foreground"
                              >
                                <BellMinus className="h-3 w-3" />
                                <span>group</span>
                                {activeSilences.length > 1 && (
                                  <span className="rounded-full bg-muted px-1 text-[10px] leading-tight">{activeSilences.length}</span>
                                )}
                              </button>
                            )}
                            {activeSilences.length === 0 && expiringSilences.length > 0 && (
                              <button
                                type="button"
                                onClick={() => openSilenceForm(group.alerts, expiringSilences[0].silence, true)}
                                title={expiringSilences.length > 1 ? `Extend ${expiringSilences.length} group silences` : 'Extend group silence'}
                                className={cn(
                                  'cursor-pointer flex w-fit items-center gap-1 rounded border px-1.5 py-0.5 text-xs transition-colors',
                                  theme === 'light'
                                    ? 'border-amber-400/70 text-amber-700 hover:border-amber-500'
                                    : 'border-yellow-700/60 text-yellow-400 hover:border-yellow-500',
                                )}
                              >
                                <RefreshCw className="h-3 w-3" />
                                <span>group</span>
                                {expiringSilences.length > 1 && (
                                  <span className={cn(
                                    'rounded-full px-1 text-[10px] leading-tight',
                                    theme === 'light' ? 'bg-amber-100' : 'bg-yellow-900/50',
                                  )}>{expiringSilences.length}</span>
                                )}
                              </button>
                            )}
                            {!hasSilence && expiredSilences.length > 0 && (
                              <button
                                type="button"
                                onClick={() => openSilenceForm(group.alerts, expiredSilences[0], true)}
                                title="Recreate group silence"
                                className="cursor-pointer flex w-fit items-center gap-1 rounded border border-border/40 px-1.5 py-0.5 text-xs text-muted-foreground/50 transition-colors hover:border-border hover:text-foreground"
                              >
                                <RefreshCw className="h-3 w-3" />
                                <span>group</span>
                              </button>
                            )}
                            {!hasSilence && expiredSilences.length === 0 && (
                              <button
                                type="button"
                                onClick={() => openSilenceForm(group.alerts)}
                                title="Silence entire group"
                                className="cursor-pointer flex w-fit items-center gap-1 rounded border border-border/50 px-1.5 py-0.5 text-xs text-muted-foreground/60 transition-colors hover:border-border hover:text-foreground"
                              >
                                <Bell className="h-3 w-3" />
                                <span>group</span>
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-muted-foreground">
                          {group.claimCount > 0 ? `${group.claimCount}/${group.alerts.length}` : '—'}
                        </td>
                      </tr>
                      {expanded &&
                        group.alerts.map((alert, idx) => (
                          <AlertListRow
                            key={alert.fingerprint}
                            alert={alert}
                            onClick={onSelectAlert}
                            selected={selectedFingerprint === alert.fingerprint}
                            indented
                            isLastInGroup={idx === group.alerts.length - 1}
                            excludeLabels={group.commonLabels}
                            silences={silences}
                            onCreateSilence={openSilenceForm}
                            onExpireSilence={(silence) => setExpireTargets([silence])}
                            showStateColumn={showStateColumn}
                          />
                        ))}
                    </Fragment>
                  )
                })}
              </Fragment>
            )
          })}
        </tbody>
      </table>

      <SilenceExpireModal
        silences={expireTargets}
        allAlerts={alerts}
        open={expireTargets.length > 0}
        onConfirm={handleExpireConfirm}
        onCancel={() => setExpireTargets([])}
        isPending={expireMutation.isPending}
      />

      <Sheet open={silenceSheet.open} onClose={closeSilenceForm} className="sm:max-w-2xl lg:max-w-3xl">
        <div className="p-5 pt-10">
          <h2 className="mb-4 text-base font-semibold">
            {silenceSheet.isRecreate ? 'Extend silence' : 'Create silence'}
          </h2>
          <SilenceForm
            availableClusters={
              clusterNames.length > 0
                ? clusterNames
                : [...new Set(silenceSheet.alerts.map((a) => a.clusterName))]
            }
            prefillAlerts={silenceSheet.alerts.length > 0 ? silenceSheet.alerts : undefined}
            prefillSilence={silenceSheet.prefillSilence}
            isRecreate={silenceSheet.isRecreate}
            onSuccess={closeSilenceForm}
            onCancel={closeSilenceForm}
          />
        </div>
      </Sheet>
    </div>
  )
}
