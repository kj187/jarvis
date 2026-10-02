import { formatDataAge } from '@/lib/dataAge'
import type { ClusterInfo } from '@/types'

export interface StaleClusterNotice {
  cluster: string
  age: string
}

/** One entry per cluster whose alerts are the last known state rather than live data. */
export function staleClusterNotices(clusters: readonly ClusterInfo[], now: number = Date.now()): StaleClusterNotice[] {
  return clusters
    .filter((c) => c.stale)
    .map((c) => ({ cluster: c.name, age: formatDataAge(c.lastSuccessfulPollAt, now) }))
}
