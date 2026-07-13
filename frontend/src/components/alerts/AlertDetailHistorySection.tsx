import { format } from 'date-fns'
import { enUS } from 'date-fns/locale'
import type { Dispatch, SetStateAction } from 'react'
import { cn } from '@/lib/utils'
import { tzAbbr } from '@/lib/alertUtils'
import type { AlertTimelineEntry } from '@/types'

interface AlertDetailHistorySectionProps {
  timelineData: { entries: AlertTimelineEntry[]; total: number } | undefined
  historyPage: number
  historyPageSize: 10 | 50 | 100
  setHistoryPage: Dispatch<SetStateAction<number>>
  setHistoryPageSize: Dispatch<SetStateAction<10 | 50 | 100>>
  alertmanagerUrl?: string
}

type HistoryRow = {
  key: string
  time: Date
  who: string
  action: string
  comment?: string
  silenceId?: string
}

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

function toHistoryAction(source: AlertTimelineEntry['source'], action: string): string {
  if (source === 'alert') return alertEventLabel[action] ?? action
  if (source === 'silence') return silenceActionLabel[action] ?? `Silence ${action}`
  return action
}

export function AlertDetailHistorySection({
  timelineData,
  historyPage,
  historyPageSize,
  setHistoryPage,
  setHistoryPageSize,
  alertmanagerUrl,
}: AlertDetailHistorySectionProps) {
  const actionColor: Record<string, string> = {
    'Alert fired': 'text-red-600 dark:text-red-400',
    'Alert resolved': 'text-green-600 dark:text-green-400',
    'Alert suppressed': 'text-muted-foreground dark:text-slate-400',
    'Silence expired': 'text-yellow-600 dark:text-yellow-400',
    claimed: 'text-blue-600 dark:text-blue-400',
    unclaimed: 'text-muted-foreground',
    'Silence pending': 'text-muted-foreground dark:text-slate-300',
    'Silence created': 'text-muted-foreground dark:text-slate-300',
    'Silence updated': 'text-muted-foreground dark:text-slate-300',
    'Silence deleted': 'text-orange-600 dark:text-orange-400',
  }

  const mappedRows: HistoryRow[] = (timelineData?.entries ?? []).map((entry) => ({
    key: `${entry.source}-${entry.sourceId}-${entry.action}-${entry.recordedAt}`,
    time: new Date(entry.recordedAt),
    who: entry.who,
    action: toHistoryAction(entry.source, entry.action),
    comment: entry.comment || undefined,
    silenceId: entry.silenceId || undefined,
  }))

  const totalRows = timelineData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalRows / historyPageSize))
  const safePage = Math.min(historyPage, totalPages)
  const pageStart = totalRows === 0 ? 0 : (safePage - 1) * historyPageSize + 1
  const pageEnd = Math.min(safePage * historyPageSize, totalRows)

  const pageSizeButtons = totalRows > 10 ? (
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
  ) : null

  const pageWindow: (number | '…')[] = (() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const pages: (number | '…')[] = [1]
    if (safePage > 3) pages.push('…')
    for (let p = Math.max(2, safePage - 1); p <= Math.min(totalPages - 1, safePage + 1); p++) pages.push(p)
    if (safePage < totalPages - 2) pages.push('…')
    pages.push(totalPages)
    return pages
  })()

  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">History</h3>
        {pageSizeButtons}
      </div>
      {!timelineData ? (
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
                  {mappedRows.map((r) => (
                    <tr key={r.key} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {format(r.time, 'yyyy-MM-dd HH:mm', { locale: enUS })} {tzAbbr}
                      </td>
                      <td className="px-3 py-2 font-medium">{r.who}</td>
                      <td className={`px-3 py-2 font-medium ${actionColor[r.action] ?? 'text-foreground'}`}>
                        {r.action}
                        {r.silenceId && (
                          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                            {alertmanagerUrl ? (
                              <a
                                href={`${alertmanagerUrl}/#/silences/${r.silenceId}`}
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
                  {pageStart}–{pageEnd} of {totalRows}
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
    </div>
  )
}
