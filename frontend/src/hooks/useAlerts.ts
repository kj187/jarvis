import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchAlerts,
  fetchAlertGroups,
  fetchAlertHistory,
  fetchAlertTimeline,
  fetchAlertStats,
} from '@/api/client'
import { FALLBACK_REFETCH_INTERVAL_MS } from '@/lib/refetch'

export function useAlerts(params?: { cluster?: string; severity?: string; state?: string }) {
  return useQuery({
    queryKey: ['alerts', params],
    queryFn: () => fetchAlerts(params),
    refetchInterval: FALLBACK_REFETCH_INTERVAL_MS,
  })
}

export function useAlertGroups() {
  return useQuery({
    queryKey: ['alerts-groups'],
    queryFn: fetchAlertGroups,
    refetchInterval: FALLBACK_REFETCH_INTERVAL_MS,
  })
}

export function useAlertHistory(fingerprint: string, cluster?: string, limit = 20, offset = 0) {
  return useQuery({
    queryKey: ['alert-history', fingerprint, cluster, limit, offset],
    queryFn: () => fetchAlertHistory(fingerprint, { cluster, limit, offset }),
    enabled: Boolean(fingerprint),
  })
}

export function useAlertTimeline(
  fingerprint: string,
  cluster: string,
  limit = 20,
  offset = 0,
) {
  return useQuery({
    queryKey: ['alert-timeline', fingerprint, cluster, limit, offset],
    queryFn: () => fetchAlertTimeline(fingerprint, { cluster, limit, offset }),
    enabled: Boolean(fingerprint),
  })
}

export function useAlertStats(fingerprint: string, cluster?: string) {
  return useQuery({
    queryKey: ['alert-stats', fingerprint, cluster],
    queryFn: () => fetchAlertStats(fingerprint, cluster),
    enabled: Boolean(fingerprint),
  })
}

export function useRefreshAlerts() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['alerts'] })
    qc.invalidateQueries({ queryKey: ['alerts-groups'] })
  }
}
