import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/tooltip'
import { heatmapCellTooltip, type HeatmapCell } from '@/lib/heatmapUtils'
import type { HeatmapRange } from '@/types'

interface HeatmapBarsProps {
  cells: HeatmapCell[]
  range: HeatmapRange
}

// Bar histogram for the detail-panel header. Bar height is the count
// relative to THIS window's own max (never a fixed scale), so a bucket
// with 100 firings and a bucket with 1 both fit the same fixed container
// height — a busy day makes its bar taller relative to the others, it
// never grows the container. The most recent bucket gets a solid fill so
// "now" stays visually anchored even when nothing else is unusual.
export function HeatmapBars({ cells, range }: HeatmapBarsProps) {
  const maxCount = Math.max(1, ...cells.map((c) => c.count))
  const lastIndex = cells.length - 1

  return (
    <div className="flex h-9 w-full items-end gap-px border-b border-border">
      {cells.map((cell, i) => {
        const pct = cell.count > 0 ? Math.max((cell.count / maxCount) * 100, 12) : 4
        const isLast = i === lastIndex
        return (
          <Tooltip key={i} content={heatmapCellTooltip(cell, range)} wrapperClassName="h-full flex-1 items-end">
            <div
              className={cn(
                'w-full rounded-t-[1px]',
                cell.count === 0
                  ? 'bg-border'
                  : isLast
                    ? 'bg-blue-600 dark:bg-blue-300'
                    : 'bg-blue-500/55 dark:bg-blue-400/55',
              )}
              style={{ height: `${pct}%` }}
            />
          </Tooltip>
        )
      })}
    </div>
  )
}
