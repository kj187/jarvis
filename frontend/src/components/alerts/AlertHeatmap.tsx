import { useState } from 'react'
import { cn } from '@/lib/utils'
import { bucketFiringStarts } from '@/lib/heatmapUtils'
import { useAlertHeatmap } from '@/hooks/useAlerts'
import { HeatmapSparkline } from './HeatmapSparkline'
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

export function AlertHeatmap({ fingerprint, cluster, enabled }: AlertHeatmapProps) {
  const [range, setRange] = useState<HeatmapRange>('24h')
  const { data, isLoading, isError } = useAlertHeatmap(fingerprint, cluster, range, enabled)

  const cells = data ? bucketFiringStarts(data.firingStarts, range) : []

  return (
    <div className="space-y-1.5">
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
      {!isLoading && !isError && <HeatmapSparkline cells={cells} range={range} />}
    </div>
  )
}
