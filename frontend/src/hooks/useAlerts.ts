import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchAlerts,
  fetchAlertGroups,
  fetchAlertHistory,
  fetchAlertStats,
} from '@/api/client'
import { useUIStore } from '@/store/uiStore'

export function useAlerts(params?: { cluster?: string; severity?: string; state?: string }) {
  const pollingPaused = useUIStore((s) => s.pollingPaused)
  return useQuery({
    queryKey: ['alerts', params],
    queryFn: () => fetchAlerts(params),
    refetchInterval: pollingPaused ? false : 15_000,
  })
}

export function useAlertGroups() {
  const pollingPaused = useUIStore((s) => s.pollingPaused)
  return useQuery({
    queryKey: ['alerts-groups'],
    queryFn: fetchAlertGroups,
    refetchInterval: pollingPaused ? false : 15_000,
  })
}

export function useAlertHistory(fingerprint: string, limit = 20, offset = 0) {
  return useQuery({
    queryKey: ['alert-history', fingerprint, limit, offset],
    queryFn: () => fetchAlertHistory(fingerprint, { limit, offset }),
    enabled: Boolean(fingerprint),
  })
}

export function useAlertStats(fingerprint: string) {
  return useQuery({
    queryKey: ['alert-stats', fingerprint],
    queryFn: () => fetchAlertStats(fingerprint),
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
