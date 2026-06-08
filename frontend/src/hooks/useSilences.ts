import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchSilences, fetchSilenceEvents, upsertSilence, deleteSilence, triggerPoll, type UpsertSilenceBody } from '@/api/client'

export function useSilenceEvents(fingerprint: string) {
  return useQuery({
    queryKey: ['silence-events', fingerprint],
    queryFn: () => fetchSilenceEvents(fingerprint),
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
