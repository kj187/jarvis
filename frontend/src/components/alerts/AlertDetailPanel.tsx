import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'
import { ExternalLink, BookOpen, ChevronDown, ChevronUp } from 'lucide-react'
import { Sheet } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { AlertBadge, StatusBadge } from './AlertBadge'
import { AlertClaimSection } from './AlertClaimSection'
import { AlertHistoryTable } from './AlertHistoryTable'
import { AlertComments } from './AlertComments'
import { useAlertHistory, useAlertStats } from '@/hooks/useAlerts'
import type { EnrichedAlert, LabelMatcher } from '@/types'

interface AlertDetailPanelProps {
  alert: EnrichedAlert | null
  onClose: () => void
  onAddLabelMatcher: (matcher: Omit<LabelMatcher, 'id'>) => void
  runbookBaseUrl?: string
}

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

export function AlertDetailPanel({
  alert,
  onClose,
  onAddLabelMatcher,
  runbookBaseUrl,
}: AlertDetailPanelProps) {
  const [historyLimit, setHistoryLimit] = useState(20)

  const { data: historyData, isLoading: historyLoading } = useAlertHistory(
    alert?.fingerprint ?? '',
    historyLimit,
  )
  const { data: stats } = useAlertStats(alert?.fingerprint ?? '')

  if (!alert) return null

  const alertname = alert.labels['alertname'] ?? 'Unknown'
  const severity = alert.labels['severity'] ?? 'none'
  const runbookLabel = alert.labels['runbook']
  const dashboardAnnotation = alert.annotations['dashboard']

  // Split labels into two columns
  const labelEntries = Object.entries(alert.labels)
  const half = Math.ceil(labelEntries.length / 2)
  const leftLabels = labelEntries.slice(0, half)
  const rightLabels = labelEntries.slice(half)

  const annotationEntries = Object.entries(alert.annotations)

  return (
    <Sheet open={!!alert} onClose={onClose}>
      {/* Header */}
      <div className="border-b border-border bg-card px-5 py-4 pt-8">
        <h2 className="text-lg font-bold break-all">{alertname}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded bg-accent px-2 py-0.5 text-xs">{alert.clusterName}</span>
          <AlertBadge severity={severity} />
          <StatusBadge state={alert.status.state} />
          <span className="text-xs text-muted-foreground">
            seit{' '}
            {formatDistanceToNow(new Date(alert.startsAt), { addSuffix: false, locale: de })}
          </span>
        </div>

        {/* Links */}
        <div className="mt-3 flex flex-wrap gap-2">
          {alert.alertmanagerUrl && (
            <a
              href={alert.alertmanagerUrl}
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
      </div>

      {/* Claiming */}
      <Section title="Claiming">
        <AlertClaimSection fingerprint={alert.fingerprint} />
      </Section>

      {/* Labels */}
      <Section title="Labels">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="space-y-1">
            {leftLabels.map(([k, v]) => (
              <div key={k} className="flex gap-1">
                <span
                  className="cursor-pointer font-mono text-muted-foreground hover:text-foreground"
                  title="Als Filter hinzufügen"
                  onClick={() =>
                    onAddLabelMatcher({ name: k, operator: '=', value: v })
                  }
                >
                  {k}
                </span>
                <span>=</span>
                <span className="break-all">{v}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {rightLabels.map(([k, v]) => (
              <div key={k} className="flex gap-1">
                <span
                  className="cursor-pointer font-mono text-muted-foreground hover:text-foreground"
                  title="Als Filter hinzufügen"
                  onClick={() =>
                    onAddLabelMatcher({ name: k, operator: '=', value: v })
                  }
                >
                  {k}
                </span>
                <span>=</span>
                <span className="break-all">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Annotations */}
      {annotationEntries.length > 0 && (
        <Section title="Annotations" defaultOpen={false}>
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

      {/* Statistics */}
      {stats && (
        <Section title="Statistik" defaultOpen={false}>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-muted-foreground">Occurrences</p>
              <p className="font-semibold">{stats.occurrenceCount}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Zuerst gesehen</p>
              <p className="font-semibold">
                {formatDistanceToNow(new Date(stats.firstSeenAt), { addSuffix: true, locale: de })}
              </p>
            </div>
          </div>
        </Section>
      )}

      {/* History */}
      <Section title="Historie" defaultOpen={false}>
        {historyData ? (
          <AlertHistoryTable
            events={historyData.events}
            total={historyData.total}
            onLoadMore={() => setHistoryLimit((l) => l + 20)}
            loading={historyLoading}
          />
        ) : (
          <p className="text-xs text-muted-foreground">Laden…</p>
        )}
      </Section>

      {/* Comments */}
      <Section title="Kommentare">
        <AlertComments fingerprint={alert.fingerprint} />
      </Section>

      {/* Alert actions */}
      <div className="border-b border-border px-5 py-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Aktionen
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          onClick={onClose}
        >
          Panel schließen
        </Button>
      </div>
    </Sheet>
  )
}
