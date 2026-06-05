import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchActiveClaim,
  fetchClaimHistory,
  setClaim,
  releaseClaim,
} from '@/api/client'

export function useActiveClaim(fingerprint: string) {
  return useQuery({
    queryKey: ['claim', fingerprint],
    queryFn: () => fetchActiveClaim(fingerprint),
    enabled: Boolean(fingerprint),
  })
}

export function useClaimHistory(fingerprint: string) {
  return useQuery({
    queryKey: ['claim-history', fingerprint],
    queryFn: () => fetchClaimHistory(fingerprint),
    enabled: Boolean(fingerprint),
  })
}

export function useSetClaim(fingerprint: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { claimedBy: string; note?: string; eventId?: number }) =>
      setClaim(fingerprint, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claim', fingerprint] })
      qc.invalidateQueries({ queryKey: ['claim-history', fingerprint] })
      qc.invalidateQueries({ queryKey: ['alerts'] })
    },
  })
}

export function useReleaseClaim(fingerprint: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (by: string) => releaseClaim(fingerprint, by),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claim', fingerprint] })
      qc.invalidateQueries({ queryKey: ['claim-history', fingerprint] })
      qc.invalidateQueries({ queryKey: ['alerts'] })
    },
  })
}
