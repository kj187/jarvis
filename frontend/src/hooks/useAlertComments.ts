import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchComments, addComment, deleteComment } from '@/api/client'

export function useAlertComments(fingerprint: string, clusterName: string) {
  return useQuery({
    queryKey: ['comments', fingerprint, clusterName],
    queryFn: () => fetchComments(fingerprint, clusterName),
    enabled: Boolean(fingerprint) && Boolean(clusterName),
  })
}

export function useAddComment(fingerprint: string, clusterName: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { authorName: string; body: string; eventId?: number }) =>
      addComment(fingerprint, clusterName, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', fingerprint, clusterName] })
    },
  })
}

export function useDeleteComment(fingerprint: string, clusterName: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteComment(fingerprint, id, clusterName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', fingerprint, clusterName] })
    },
  })
}
