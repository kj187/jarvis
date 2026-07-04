import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchSilences, fetchSilenceEvents, upsertSilence, deleteSilence, triggerPoll, type UpsertSilenceBody } from '@/api/client'
import { buildAckSilenceBody } from '@/lib/alertUtils'
import { useSettingsStore } from '@/store/useSettingsStore'
import { useAuthStore } from '@/store/authStore'
import type { EnrichedAlert } from '@/types'

const USERNAME_KEY = 'jarvis-username'

/**
 * Resolves the silence creator name the same way `SilenceForm` does:
 * session username when authenticated, otherwise the manually stored
 * `jarvis-username` / `defaultCreatorName`. Falls back to `jarvis` so a
 * one-click ack in `none` mode never sends an empty `createdBy` (which
 * Alertmanager rejects).
 */
export function resolveCreatorName(): string {
  const user = useAuthStore.getState().user
  const stored = localStorage.getItem(USERNAME_KEY) ?? useSettingsStore.getState().defaultCreatorName
  return (user?.username ?? stored ?? '').trim() || 'jarvis'
}

export function useSilenceEvents(fingerprint: string, cluster?: string) {
  return useQuery({
    queryKey: ['silence-events', fingerprint, cluster],
    queryFn: () => fetchSilenceEvents(fingerprint, cluster),
    enabled: Boolean(fingerprint),
  })
}

export function useSilences(cluster?: string) {
  return useQuery({
    queryKey: ['silences', cluster],
    queryFn: () => fetchSilences(cluster),
    refetchInterval: 30_000,
  })
}

export function useUpsertSilence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UpsertSilenceBody) => upsertSilence(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['silences'] })
      qc.invalidateQueries({ queryKey: ['silence-events'] })
      triggerPoll().catch(() => {})
    },
  })
}

/**
 * One-click Fast-Silence: creates a short-lived exact-match silence for a
 * single alert for the caller-supplied `durationMinutes`. Thin wrapper over
 * `useUpsertSilence` — reuses its cache invalidation + poll trigger.
 */
export function useAckAlert() {
  const upsert = useUpsertSilence()
  const ack = (alert: EnrichedAlert, durationMinutes: number) =>
    upsert.mutateAsync(buildAckSilenceBody(alert, durationMinutes, resolveCreatorName()))
  return { ack, isPending: upsert.isPending }
}

export function useDeleteSilence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      cluster,
      fingerprint,
      by,
    }: {
      id: string
      cluster: string
      fingerprint?: string
      by?: string
    }) => deleteSilence(id, cluster, { fingerprint, by }),
    onSuccess: (_, { fingerprint }) => {
      qc.invalidateQueries({ queryKey: ['silences'] })
      if (fingerprint) qc.invalidateQueries({ queryKey: ['silence-events', fingerprint] })
      triggerPoll().catch(() => {})
    },
  })
}
