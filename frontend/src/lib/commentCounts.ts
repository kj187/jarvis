import type { EnrichedAlert } from '@/types'

// Same key shape the backend uses in GET /alerts/comment-counts.
export function commentCountKey(clusterName: string, fingerprint: string): string {
  return `${clusterName}::${fingerprint}`
}

// The counts endpoint only answers for alerts in the live snapshot, so a
// changed alert set (a re-firing alert with old comments) makes it stale.
export function alertKeySetChanged(prev: unknown, next: EnrichedAlert[]): boolean {
  if (!Array.isArray(prev)) return true
  const keys = (alerts: EnrichedAlert[]) => new Set(alerts.map((a) => commentCountKey(a.clusterName, a.fingerprint)))
  const before = keys(prev as EnrichedAlert[])
  const after = keys(next)
  return before.size !== after.size || [...after].some((k) => !before.has(k))
}
