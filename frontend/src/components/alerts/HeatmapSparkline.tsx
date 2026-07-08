import { Tooltip } from '@/components/ui/tooltip'
import { heatmapCellTooltip, type HeatmapCell } from '@/lib/heatmapUtils'
import type { HeatmapRange } from '@/types'

const WIDTH = 400
const HEIGHT = 34
const PAD_Y = 3
const GRADIENT_ID = 'heatmap-sparkline-gradient'

function smoothPath(points: [number, number][]): string {
  let d = `M ${points[0][0]},${points[0][1]}`
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i]
    const [x1, y1] = points[i + 1]
    const mx = (x0 + x1) / 2
    d += ` C ${mx},${y0} ${mx},${y1} ${x1},${y1}`
  }
  return d
}

interface HeatmapSparklineProps {
  cells: HeatmapCell[]
  range: HeatmapRange
}

// Line/area sparkline for the detail-panel header — smooth path with a soft
// fill, a faint baseline, and an emphasized endpoint (most recent bucket).
// Per-bucket hover hit-areas sit as invisible flex cells above the SVG so
// tooltips still work per data point despite the continuous line.
export function HeatmapSparkline({ cells, range }: HeatmapSparklineProps) {
  const maxCount = Math.max(1, ...cells.map((c) => c.count))
  const n = cells.length
  const stepX = n > 1 ? WIDTH / (n - 1) : WIDTH
  const hasData = cells.some((c) => c.count > 0)

  const points: [number, number][] = cells.map((c, i) => {
    const x = i * stepX
    const y = HEIGHT - (c.count / maxCount) * (HEIGHT - PAD_Y * 2) - PAD_Y
    return [x, y]
  })

  const linePath = smoothPath(points)
  const areaPath = `${linePath} L ${WIDTH},${HEIGHT} L 0,${HEIGHT} Z`
  const last = points[points.length - 1]

  return (
    <div className="relative h-9 w-full">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <line x1="0" y1={HEIGHT - 0.5} x2={WIDTH} y2={HEIGHT - 0.5} className="stroke-border" strokeWidth="1" />
        {hasData && (
          <defs>
            <linearGradient id={GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className="text-blue-500 dark:text-blue-400" stopColor="currentColor" stopOpacity="0.3" />
              <stop offset="100%" className="text-blue-500 dark:text-blue-400" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
        )}
        {hasData && <path d={areaPath} fill={`url(#${GRADIENT_ID})`} stroke="none" />}
        <path
          d={linePath}
          fill="none"
          className={hasData ? 'stroke-blue-500 dark:stroke-blue-400' : 'stroke-border'}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {hasData && <circle cx={last[0]} cy={last[1]} r="2.5" className="fill-blue-500 dark:fill-blue-400" />}
      </svg>
      <div className="absolute inset-0 flex">
        {cells.map((cell, i) => (
          <Tooltip key={i} content={heatmapCellTooltip(cell, range)} wrapperClassName="h-full flex-1">
            <div className="h-full w-full" />
          </Tooltip>
        ))}
      </div>
    </div>
  )
}
