import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchSilences, upsertSilence, deleteSilence, type UpsertSilenceBody } from '@/api/client'

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['silences'] })
    },
  })
}
