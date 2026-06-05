import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchComments, addComment, deleteComment } from '@/api/client'

export function useAlertComments(fingerprint: string) {
  return useQuery({
    queryKey: ['comments', fingerprint],
    queryFn: () => fetchComments(fingerprint),
    enabled: Boolean(fingerprint),
  })
}

export function useAddComment(fingerprint: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { authorName: string; body: string; eventId?: number }) =>
      addComment(fingerprint, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', fingerprint] })
    },
  })
}

export function useDeleteComment(fingerprint: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteComment(fingerprint, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', fingerprint] })
    },
  })
}
