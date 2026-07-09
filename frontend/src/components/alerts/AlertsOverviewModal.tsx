import { useMemo } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { useAlerts } from '@/hooks/useAlerts'
import { useSilences } from '@/hooks/useSilences'
import { useUIStore } from '@/store/uiStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { computeLabelBreakdown, getEffectiveAlertState, labelColorStyle } from '@/lib/alertUtils'

interface AlertsOverviewModalProps {
  open: boolean
  onClose: () => void
}

/**
 * Karma-style alert overview: top label values across the current state tab
 * (active/suppressed/resolved), ignoring the label-matcher filter bar — the
 * point is discovering what to filter *by*, not summarizing what's already
 * filtered. Clicking a value applies it as an unlocked `=` filter chip.
 */
export function AlertsOverviewModal({ open, onClose }: AlertsOverviewModalProps) {
  const filters = useUIStore((s) => s.filters)
  const addLabelMatcher = useUIStore((s) => s.addLabelMatcher)
  const theme = useSettingsStore((s) => s.theme)

  const isResolvedMode = filters.state === 'resolved'
  const { data: liveAlerts = [] } = useAlerts()
  const { data: resolvedAlerts = [] } = useAlerts({ state: 'resolved' })
  const { data: silences = [] } = useSilences()

  const alerts = isResolvedMode ? resolvedAlerts : liveAlerts

  const basisAlerts = useMemo(() => {
    if (isResolvedMode || !filters.state) return alerts
    return alerts.filter((a) => getEffectiveAlertState(a, silences) === filters.state)
  }, [alerts, filters.state, isResolvedMode, silences])

  const breakdown = useMemo(() => computeLabelBreakdown(basisAlerts), [basisAlerts])

  function handleValueClick(name: string, value: string) {
    const alreadyApplied = filters.labelMatchers.some(
      (m) => m.name === name && m.operator === '=' && m.value === value,
    )
    if (!alreadyApplied) addLabelMatcher({ name, operator: '=', value })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} className="sm:max-w-2xl">
      <div className="p-6 space-y-4">
        <div className="space-y-1 pr-6">
          <h2 className="text-base font-semibold">Alerts Overview</h2>
          <p className="text-xs text-muted-foreground">
            Top label values across {basisAlerts.length} alert{basisAlerts.length === 1 ? '' : 's'}. Click a value to filter by it.
          </p>
        </div>

        {basisAlerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No alerts to summarize.</p>
        ) : (
          <div className="sheet-scroll max-h-[70vh] space-y-4 overflow-y-auto -mr-2 pr-2">
            {breakdown.map((b) => (
              <div key={b.name}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span
                    className="rounded border px-1.5 py-0.5 text-[10px] font-medium"
                    style={labelColorStyle(b.name, theme)}
                  >
                    {b.name}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {b.total} alert{b.total === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {b.values.map((v) => (
                    <button
                      key={v.value}
                      onClick={() => handleValueClick(b.name, v.value)}
                      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent/60"
                      aria-label={`Filter by ${b.name}=${v.value}`}
                    >
                      <span className="truncate">{v.value}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{v.count}</span>
                    </button>
                  ))}
                  {b.truncated > 0 && (
                    <p className="px-2 text-[10px] text-muted-foreground">+{b.truncated} more</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  )
}
