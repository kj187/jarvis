import { useState } from 'react'
import { format } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { tzAbbr } from '@/lib/alertUtils'
import { bucketFiringStarts, type HeatmapCell } from '@/lib/heatmapUtils'
import { useAlertHeatmap } from '@/hooks/useAlerts'
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

// One accent hue, opacity steps chosen to stay legible on both the light and
// dark card background (`AlertDetailSection`'s surrounding surface).
const INTENSITY_CLASSES = [
  'bg-transparent border border-border',
  'bg-blue-500/20 dark:bg-blue-400/20',
  'bg-blue-500/40 dark:bg-blue-400/35',
  'bg-blue-500/65 dark:bg-blue-400/55',
  'bg-blue-500/90 dark:bg-blue-400/80',
]

function intensityLevel(count: number, maxCount: number): number {
  if (count === 0 || maxCount === 0) return 0
  const ratio = count / maxCount
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}

function cellTooltip(cell: HeatmapCell, range: HeatmapRange): string {
  const plural = cell.count === 1 ? 'firing' : 'firings'
  if (range === '30d') {
    return `${format(cell.start, 'MMM d, yyyy', { locale: enUS })} — ${cell.count} ${plural}`
  }
  return `${format(cell.start, 'MMM d, HH:mm', { locale: enUS })}–${format(cell.end, 'HH:mm', { locale: enUS })} ${tzAbbr} — ${cell.count} ${plural}`
}

function HeatmapGrid({ cells, range }: { cells: HeatmapCell[]; range: HeatmapRange }) {
  const maxCount = Math.max(0, ...cells.map((c) => c.count))

  const renderCell = (cell: HeatmapCell, key: string) => (
    <div
      key={key}
      title={cellTooltip(cell, range)}
      className={cn('h-4 flex-1 rounded-sm', INTENSITY_CLASSES[intensityLevel(cell.count, maxCount)])}
    />
  )

  if (range === '7d') {
    const days = Array.from({ length: 7 }, (_, i) => cells.slice(i * 24, i * 24 + 24))
    return (
      <div className="space-y-1">
        {days.map((dayCells, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-8 shrink-0 text-[10px] text-muted-foreground">
              {dayCells[0] ? format(dayCells[0].start, 'EEE', { locale: enUS }) : ''}
            </span>
            <div className="flex flex-1 gap-px">
              {dayCells.map((cell, j) => renderCell(cell, `${i}-${j}`))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return <div className="flex gap-px">{cells.map((cell, i) => renderCell(cell, String(i)))}</div>
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
