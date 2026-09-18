import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchAlerts,
  fetchAlertGroups,
  fetchAlertHistory,
  fetchAlertTimeline,
  fetchAlertStats,
  fetchAlertHeatmap,
  fetchResolvedAlertsPage,
  type ResolvedAlertsPageParams,
} from '@/api/client'
import { FALLBACK_REFETCH_INTERVAL_MS } from '@/lib/refetch'
import type { HeatmapRange } from '@/types'

export function useAlerts(
  params?: { cluster?: string; severity?: string; state?: string },
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ['alerts', params],
    queryFn: ({ signal }) => fetchAlerts(params, signal),
    refetchInterval: FALLBACK_REFETCH_INTERVAL_MS,
    enabled: options.enabled,
  })
}

export function useAlertGroups() {
  return useQuery({
    queryKey: ['alerts-groups'],
    queryFn: fetchAlertGroups,
    refetchInterval: FALLBACK_REFETCH_INTERVAL_MS,
  })
}

export function useResolvedAlertsPage(params: ResolvedAlertsPageParams, enabled: boolean) {
  return useQuery({
    queryKey: ['alerts-resolved-page', params],
    queryFn: async ({ signal }) => ({
      ...await fetchResolvedAlertsPage(params, signal),
      requestedOffset: params.offset ?? 0,
    }),
    enabled,
    staleTime: 10_000,
    gcTime: 0,
    refetchInterval: enabled ? FALLBACK_REFETCH_INTERVAL_MS : false,
    retry: (failureCount, error) => !/^4\d\d:/.test(error.message) && failureCount < 1,
    placeholderData: (previousData, previousQuery) => {
      const previousParams = previousQuery?.queryKey[1] as ResolvedAlertsPageParams | undefined
      if (!previousParams || previousParams.limit !== params.limit || previousParams.offset === params.offset) {
        return undefined
      }
      const comparable = (value: ResolvedAlertsPageParams) => JSON.stringify({
        cluster: value.cluster,
        severity: value.severity,
        search: value.search,
        matchers: value.matchers,
      })
      return comparable(previousParams) === comparable(params) ? previousData : undefined
    },
  })
}

export function useResolvedAlertDetail(fingerprint: string, cluster: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['alerts-resolved-detail', fingerprint, cluster],
    queryFn: ({ signal }) => fetchResolvedAlertsPage({ fingerprint, cluster }, signal),
    enabled: enabled && Boolean(fingerprint),
    staleTime: 10_000,
    gcTime: 0,
    retry: (failureCount, error) => !/^4\d\d:/.test(error.message) && failureCount < 1,
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
    qc.invalidateQueries({ queryKey: ['alerts-resolved-page'] })
    qc.invalidateQueries({ queryKey: ['alerts-resolved-detail'] })
  }
}
