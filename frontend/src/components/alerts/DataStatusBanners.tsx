import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchClusters } from '@/api/client'
import { staleClusterNotices } from '@/lib/dataStatus'
import { FALLBACK_REFETCH_INTERVAL_MS } from '@/lib/refetch'
import { useUIStore } from '@/store/uiStore'

// A short drop (backend rollout, network blip) reconnects within seconds; only
// a connection that stays down this long is worth a banner.
const WS_LOST_NOTICE_DELAY_MS = 10_000

const WARNING_BANNER = 'rounded-control border border-warning-edge bg-warning-soft px-3 py-1.5 text-xs text-warning-fg'
const ERROR_BANNER = 'flex items-center gap-3 rounded-control border border-critical-edge bg-critical-soft px-3 py-1.5 text-xs text-critical-fg'

function WsLostNotice() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), WS_LOST_NOTICE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])
  if (!visible) return null
  return (
    <div className={WARNING_BANNER} role="status" data-testid="ws-lost-banner">
      Live connection interrupted, reconnecting. Until it is back, alerts refresh every{' '}
      {FALLBACK_REFETCH_INTERVAL_MS / 1000} seconds.
    </div>
  )
}

export function DataStatusBanners({ refreshFailed, onRetry }: { refreshFailed: boolean; onRetry: () => void }) {
  const wsConnected = useUIStore((s) => s.wsConnected)
  const { data: clusters = [] } = useQuery({
    queryKey: ['clusters'],
    queryFn: fetchClusters,
    refetchInterval: FALLBACK_REFETCH_INTERVAL_MS,
  })
  const stale = staleClusterNotices(clusters)

  return (
    <div className="flex flex-col gap-1.5 px-4 empty:hidden">
      {refreshFailed && (
        <div className={ERROR_BANNER} role="alert" data-testid="refresh-failed-banner">
          <span>Could not refresh alerts. Showing the last data received.</span>
          <button
            type="button"
            className="cursor-pointer rounded-control border border-border px-2 py-1 text-foreground hover:bg-accent"
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      )}
      {stale.map((n) => (
        <div key={n.cluster} className={WARNING_BANNER} role="status" data-testid="stale-cluster-banner">
          <span className="font-medium">{n.cluster}</span>: Alertmanager data is from {n.age}. The alerts shown are the last
          known state, not live.
        </div>
      ))}
      {!wsConnected && <WsLostNotice />}
    </div>
  )
}
