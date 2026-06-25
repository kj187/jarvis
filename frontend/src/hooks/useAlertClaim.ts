import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  fetchActiveClaim,
  fetchClaimHistory,
  setClaim,
  releaseClaim,
} from '@/api/client'

function invalidateClaimQueries(qc: QueryClient, fingerprint: string, clusterName: string): void {
  qc.invalidateQueries({ queryKey: ['claim', fingerprint, clusterName] })
  qc.invalidateQueries({ queryKey: ['claim-history', fingerprint, clusterName] })
  qc.invalidateQueries({ queryKey: ['alerts'] })
}

export function useActiveClaim(fingerprint: string, clusterName: string) {
  return useQuery({
    queryKey: ['claim', fingerprint, clusterName],
    queryFn: () => fetchActiveClaim(fingerprint, clusterName),
    enabled: Boolean(fingerprint),
  })
}

export function useClaimHistory(fingerprint: string, clusterName: string) {
  return useQuery({
    queryKey: ['claim-history', fingerprint, clusterName],
    queryFn: () => fetchClaimHistory(fingerprint, clusterName),
    enabled: Boolean(fingerprint),
  })
}

export function useSetClaim(fingerprint: string, clusterName: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { claimedBy: string; note?: string; eventId?: number }) =>
      setClaim(fingerprint, clusterName, body),
    onSuccess: () => invalidateClaimQueries(qc, fingerprint, clusterName),
  })
}

export function useReleaseClaim(fingerprint: string, clusterName: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (by: string) => releaseClaim(fingerprint, clusterName, by),
    onSuccess: () => invalidateClaimQueries(qc, fingerprint, clusterName),
  })
}
