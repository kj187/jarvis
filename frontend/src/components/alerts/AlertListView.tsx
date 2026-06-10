import { Fragment, useState } from 'react'
import { ArrowUpDown, Bell, BellOff, ChevronDown, ChevronRight, RefreshCw, X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertListRow } from './AlertListRow'
import { StatusBadge } from './AlertBadge'
import { HIDDEN_LABEL_KEYS, LabelChip } from './LabelChip'
import { Sheet } from '@/components/ui/sheet'
import { SilenceForm } from '@/components/silences/SilenceForm'
import { fetchClusters, deleteSilence } from '@/api/client'
import { formatSilenceDuration, severityOrder } from '@/lib/alertUtils'
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

type SortKey = 'alertname' | 'time'

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

const SEVERITY_ORDER = ['critical', 'warning', 'info', 'none']

const severitySectionConfig: Record<string, { label: string; rowClass: string; borderClass: string }> = {
  critical: {
    label: 'Critical',
    rowClass: 'text-red-400 bg-red-950/30',
    borderClass: 'border-l-red-600',
  },
  warning: {
    label: 'Warning',
    rowClass: 'text-yellow-300 bg-yellow-950/30',
    borderClass: 'border-l-yellow-500',
  },
  info: {
    label: 'Info',
    rowClass: 'text-blue-400 bg-blue-950/30',
    borderClass: 'border-l-blue-600',
  },
  none: {
    label: 'None',
    rowClass: 'text-slate-400 bg-slate-900/30',
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

  const expired = silences.filter(
    (s) =>
      s.status.state === 'expired' &&
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

  const qc = useQueryClient()
  const { data: clusters = [] } = useQuery({ queryKey: ['clusters'], queryFn: fetchClusters })
  const clusterNames = clusters.map((c) => c.name)

  const expireMutation = useMutation({
    mutationFn: ({ id, cluster }: { id: string; cluster: string }) => deleteSilence(id, cluster),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['silences'] }),
  })

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
      let cmp = 0
      switch (sortKey) {
        case 'alertname':
          cmp = a.alertname.localeCompare(b.alertname)
          break
        case 'time':
          cmp = a.earliestStart.getTime() - b.earliestStart.getTime()
          break
      }
      return sortAsc ? cmp : -cmp
    })
  }

  const groupsBySeverity = buildGroupsBySeverity(alerts)
  const presentSeverities = [
    ...SEVERITY_ORDER.filter((s) => groupsBySeverity.has(s)),
    ...[...groupsBySeverity.keys()].filter((s) => !SEVERITY_ORDER.includes(s)),
  ]

  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <p className="text-lg">No alerts</p>
      </div>
    )
  }

  // ── Resolved mode: flat list sorted by endsAt desc ─────────────────────────
  if (resolvedMode) {
    const sorted = [...alerts].sort((a, b) => {
      const timeDiff = new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime()
      if (timeDiff !== 0) return timeDiff
      const sevDiff = severityOrder(a.labels['severity'] ?? 'none') - severityOrder(b.labels['severity'] ?? 'none')
      if (sevDiff !== 0) return sevDiff
      return (a.labels['alertname'] ?? '').localeCompare(b.labels['alertname'] ?? '')
    })
    return (
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
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Time
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((alert) => (
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
              prefillAlerts={silenceSheet.prefillSilence ? undefined : silenceSheet.alerts}
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
            <SortHeader label="Time" sortKeyVal="time" />
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
              rowClass: 'text-slate-400 bg-slate-900/30',
              borderClass: 'border-l-slate-600',
            }
            const totalAlerts = groups.reduce((sum, g) => sum + g.alerts.length, 0)
            return (
              <Fragment key={severity}>
                <tr aria-hidden="true">
                  <td colSpan={showStateColumn ? 5 : 4} className="h-8 bg-background p-0" />
                </tr>
                <tr>
                  <td
                    colSpan={showStateColumn ? 5 : 4}
                    className={cn(
                      'border-l-4 px-4 py-2',
                      cfg.rowClass,
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
                  return (
                    <Fragment key={groupKey}>
                      <tr
                        role="row"
                        tabIndex={0}
                        onClick={() => toggleGroup(groupKey)}
                        onKeyDown={(e) => e.key === 'Enter' && toggleGroup(groupKey)}
                        className={cn(
                          'cursor-pointer transition-colors hover:bg-muted/50',
                          expanded ? 'bg-muted/40' : 'bg-muted/30',
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
                            </span>
                            {group.commonSummary && (
                              <span className="pl-6 text-xs text-muted-foreground">{group.commonSummary}</span>
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
                        <td className="px-4 py-2.5 text-sm text-muted-foreground">
                          {formatDistanceToNow(group.earliestStart, { addSuffix: true, locale: enUS })}
                        </td>
                        <td className="px-4 py-2.5">
                          {(() => {
                            const { active, expiring, expired } = getGroupSilenceInfo(group.alerts, group.alertname, silences)
                            const hasSilence = active.length > 0 || expiring.length > 0
                            return (
                              <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                                {active.map(({ silence, remaining }) => (
                                  <div key={silence.id} className="flex items-center gap-1 text-xs text-slate-300">
                                    <BellOff className="h-3 w-3 shrink-0" />
                                    <span>{formatSilenceDuration(remaining)}</span>
                                    <button
                                      type="button"
                                      onClick={() => expireMutation.mutate({ id: silence.id, cluster: silence.clusterName })}
                                      title="Expire silence"
                                      className="cursor-pointer rounded p-0.5 hover:bg-slate-700"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                ))}
                                {expiring.map(({ silence, remaining }) => (
                                  <div key={silence.id} className="flex items-center gap-1 text-xs text-yellow-400">
                                    <BellOff className="h-3 w-3 shrink-0" />
                                    <span>{formatSilenceDuration(remaining)}</span>
                                    <button
                                      type="button"
                                      onClick={() => openSilenceForm(group.alerts, silence, true)}
                                      title="Extend silence"
                                      className="cursor-pointer rounded p-0.5 hover:bg-yellow-900/40"
                                    >
                                      <RefreshCw className="h-3 w-3" />
                                    </button>
                                  </div>
                                ))}
                                {!hasSilence && expired.length > 0 && (
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground/50">
                                    <BellOff className="h-3 w-3 shrink-0" />
                                    <span>expired</span>
                                    <button
                                      type="button"
                                      onClick={() => openSilenceForm(group.alerts, expired[0], true)}
                                      title="Recreate silence"
                                      className="cursor-pointer rounded p-0.5 hover:text-foreground"
                                    >
                                      <RefreshCw className="h-3 w-3" />
                                    </button>
                                  </div>
                                )}
                                {!hasSilence && expired.length === 0 && (
                                  <button
                                    type="button"
                                    onClick={() => openSilenceForm(group.alerts)}
                                    title="Create silence"
                                    className="cursor-pointer w-fit text-muted-foreground/50 transition-colors hover:text-foreground"
                                  >
                                    <Bell className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            )
                          })()}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-muted-foreground">
                          {group.claimCount > 0 ? `${group.claimCount}×` : '—'}
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
                            onExpireSilence={(id, cluster) => expireMutation.mutate({ id, cluster })}
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
            prefillAlerts={silenceSheet.prefillSilence ? undefined : silenceSheet.alerts}
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
