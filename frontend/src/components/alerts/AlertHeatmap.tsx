import { useState } from 'react'
import { format } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { bucketFiringStarts, type HeatmapCell } from '@/lib/heatmapUtils'
import { useAlertHeatmap } from '@/hooks/useAlerts'
import { HeatmapCellsRow } from './HeatmapCells'
import type { HeatmapRange } from '@/types'

interface AlertHeatmapProps {
  fingerprint: string
  cluster?: string
  enabled: boolean
}

const RANGES: { value: HeatmapRange; label: string }[] = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
]

function HeatmapGrid({ cells, range }: { cells: HeatmapCell[]; range: HeatmapRange }) {
  const maxCount = Math.max(0, ...cells.map((c) => c.count))

  if (range === '7d') {
    const days = Array.from({ length: 7 }, (_, i) => cells.slice(i * 24, i * 24 + 24))
    return (
      <div className="space-y-1">
        {days.map((dayCells, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-8 shrink-0 text-[10px] text-muted-foreground">
              {dayCells[0] ? format(dayCells[0].start, 'EEE', { locale: enUS }) : ''}
            </span>
            <div className="flex-1">
              <HeatmapCellsRow cells={dayCells} range={range} maxCount={maxCount} tooltips />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return <HeatmapCellsRow cells={cells} range={range} maxCount={maxCount} tooltips />
}

export function AlertHeatmap({ fingerprint, cluster, enabled }: AlertHeatmapProps) {
  const [range, setRange] = useState<HeatmapRange>('24h')
  const { data, isLoading, isError } = useAlertHeatmap(fingerprint, cluster, range, enabled)

  const cells = data ? bucketFiringStarts(data.firingStarts, range) : []

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">When and how often this alert fired</p>
        <div className="flex items-center gap-1 rounded border border-border p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={cn(
                'rounded px-2 py-0.5 text-[10px] font-medium cursor-pointer',
                range === r.value
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {isError && <p className="text-xs text-destructive">Failed to load firing pattern.</p>}
      {!isLoading && !isError && <HeatmapGrid cells={cells} range={range} />}
    </div>
  )
}
