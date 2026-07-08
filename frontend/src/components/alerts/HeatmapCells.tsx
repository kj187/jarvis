import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/tooltip'
import {
  HEATMAP_INTENSITY_CLASSES,
  heatmapIntensityLevel,
  heatmapCellTooltip,
  type HeatmapCell,
} from '@/lib/heatmapUtils'
import type { HeatmapRange } from '@/types'

interface HeatmapCellsRowProps {
  cells: HeatmapCell[]
  range: HeatmapRange
  cellClassName?: string
  /** Hover tooltips per cell. Off by default for compact/decorative uses (e.g. card sparklines). */
  tooltips?: boolean
  /** Intensity denominator. Defaults to this row's own max — pass the caller's
   *  cross-row max (e.g. the whole 7d grid) to keep scaling consistent across rows. */
  maxCount?: number
  /** Class for empty (count=0) cells. Defaults to a visible border — pass a
   *  faint one for decorative/compact uses (e.g. card sparklines) so an
   *  all-empty row doesn't read as a grid of boxes. */
  emptyClassName?: string
}

export function HeatmapCellsRow({
  cells,
  range,
  cellClassName,
  tooltips = false,
  maxCount,
  emptyClassName,
}: HeatmapCellsRowProps) {
  const effectiveMax = maxCount ?? Math.max(0, ...cells.map((c) => c.count))
  return (
    <div className="flex gap-px">
      {cells.map((cell, i) => {
        const level = heatmapIntensityLevel(cell.count, effectiveMax)
        const box = (
          <div
            className={cn(
              cellClassName ?? 'h-4 w-full rounded-sm',
              level === 0 ? (emptyClassName ?? HEATMAP_INTENSITY_CLASSES[0]) : HEATMAP_INTENSITY_CLASSES[level],
            )}
          />
        )
        if (!tooltips) return <div key={i} className="flex-1">{box}</div>
        return (
          <Tooltip key={i} content={heatmapCellTooltip(cell, range)} wrapperClassName="flex-1">
            {box}
          </Tooltip>
        )
      })}
    </div>
  )
}
