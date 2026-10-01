import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchComments, fetchCommentCounts, addComment, deleteComment } from '@/api/client'
import { FALLBACK_REFETCH_INTERVAL_MS } from '@/lib/refetch'
import { commentCountKey } from '@/lib/commentCounts'

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

export const COMMENT_COUNTS_KEY = ['comment-counts'] as const

// One shared request for every card/row; each caller only re-renders when its own count changes.
export function useCommentCount(fingerprint: string, clusterName: string): number {
  const { data } = useQuery({
    queryKey: COMMENT_COUNTS_KEY,
    queryFn: fetchCommentCounts,
    refetchInterval: FALLBACK_REFETCH_INTERVAL_MS,
    select: (d) => d.counts[commentCountKey(clusterName, fingerprint)] ?? 0,
  })
  return data ?? 0
}

export function useCommentCountSum(alerts: { fingerprint: string; clusterName: string }[]): number {
  const { data } = useQuery({
    queryKey: COMMENT_COUNTS_KEY,
    queryFn: fetchCommentCounts,
    refetchInterval: FALLBACK_REFETCH_INTERVAL_MS,
    select: (d) => alerts.reduce((sum, a) => sum + (d.counts[commentCountKey(a.clusterName, a.fingerprint)] ?? 0), 0),
  })
  return data ?? 0
}

export function useAddComment(fingerprint: string, clusterName: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { authorName: string; body: string; eventId?: number }) =>
      addComment(fingerprint, clusterName, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', fingerprint, clusterName] })
      qc.invalidateQueries({ queryKey: COMMENT_COUNTS_KEY })
    },
  })
}

export function useDeleteComment(fingerprint: string, clusterName: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteComment(fingerprint, id, clusterName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', fingerprint, clusterName] })
      qc.invalidateQueries({ queryKey: COMMENT_COUNTS_KEY })
    },
  })
}
