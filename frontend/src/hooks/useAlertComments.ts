import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchComments, addComment, deleteComment } from '@/api/client'

export const COMMENTS_PAGE_SIZE = 5

export function useAlertComments(fingerprint: string, clusterName: string, page: number) {
  return useQuery({
    queryKey: ['comments', fingerprint, clusterName, page],
    queryFn: () =>
      fetchComments(fingerprint, clusterName, {
        limit: COMMENTS_PAGE_SIZE,
        offset: (page - 1) * COMMENTS_PAGE_SIZE,
      }),
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
