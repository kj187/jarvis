import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchAlerts,
  fetchAlertGroups,
  fetchAlertHistory,
  fetchAlertTimeline,
  fetchAlertStats,
  fetchAlertHeatmap,
} from '@/api/client'
import { FALLBACK_REFETCH_INTERVAL_MS } from '@/lib/refetch'
import type { HeatmapRange } from '@/types'

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

export function useAlertHeatmap(
  fingerprint: string,
  cluster: string | undefined,
  range: HeatmapRange,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['alert-heatmap', fingerprint, cluster, range],
    queryFn: () => fetchAlertHeatmap(fingerprint, range, cluster),
    enabled: Boolean(fingerprint) && enabled,
    staleTime: 60_000,
  })
}

export function useRefreshAlerts() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['alerts'] })
    qc.invalidateQueries({ queryKey: ['alerts-groups'] })
  }
}
