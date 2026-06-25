import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  fetchActiveClaim,
  fetchClaimHistory,
  setClaim,
  releaseClaim,
  updateClaimNote,
} from '@/api/client'
import { useAuthStore } from '@/store/authStore'

export const USERNAME_KEY = 'jarvis-username'

function invalidateClaimQueries(qc: QueryClient, fingerprint: string, clusterName: string): void {
  qc.invalidateQueries({ queryKey: ['claim', fingerprint, clusterName] })
  qc.invalidateQueries({ queryKey: ['claim-history', fingerprint, clusterName] })
  qc.invalidateQueries({ queryKey: ['alerts'] })
  // Claim actions appear in the merged detail timeline and stats, so refresh
  // those too — otherwise the new history entry only shows after a reload.
  qc.invalidateQueries({ queryKey: ['alert-timeline', fingerprint, clusterName] })
  qc.invalidateQueries({ queryKey: ['alert-stats', fingerprint] })
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

export function useUpdateClaimNote(fingerprint: string, clusterName: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { claimedBy: string; note: string }) =>
      updateClaimNote(fingerprint, clusterName, body),
    onSuccess: () => invalidateClaimQueries(qc, fingerprint, clusterName),
  })
}

/**
 * Centralizes the shared claim/release behavior used by both the alert detail
 * panel and the alert list row: actor resolution (auth user vs. locally stored
 * name), localStorage persistence in unauthenticated mode, and the underlying
 * set/release mutations. UI is intentionally left to the consumer.
 */
export function useClaimController(fingerprint: string, clusterName: string) {
  const setClaimMutation = useSetClaim(fingerprint, clusterName)
  const releaseMutation = useReleaseClaim(fingerprint, clusterName)
  const updateNoteMutation = useUpdateClaimNote(fingerprint, clusterName)
  const { user, providerInfo } = useAuthStore()
  const authMode = providerInfo?.mode ?? 'none'

  const storedName = (): string => localStorage.getItem(USERNAME_KEY) ?? ''
  const currentActor = (): string => user?.username ?? (storedName() || 'unknown')

  const claim = (
    input: { claimedBy: string; note?: string },
    options?: Parameters<typeof setClaimMutation.mutate>[1],
  ): void => {
    const name = input.claimedBy.trim()
    if (!name) return
    if (authMode === 'none') localStorage.setItem(USERNAME_KEY, name)
    setClaimMutation.mutate({ claimedBy: name, note: input.note?.trim() || undefined }, options)
  }

  const release = (options?: Parameters<typeof releaseMutation.mutate>[1]): void => {
    releaseMutation.mutate(currentActor(), options)
  }

  // True when the current actor owns the given claim and may edit its note.
  const isOwner = (claimedBy: string): boolean =>
    authMode !== 'none' ? user?.username === claimedBy : storedName() === claimedBy

  const updateNote = (
    note: string,
    options?: Parameters<typeof updateNoteMutation.mutate>[1],
  ): void => {
    updateNoteMutation.mutate({ claimedBy: currentActor(), note: note.trim() }, options)
  }

  return {
    setClaimMutation,
    releaseMutation,
    updateNoteMutation,
    user,
    authMode,
    storedName,
    currentActor,
    isOwner,
    claim,
    release,
    updateNote,
  }
}
