import { MessageSquare } from 'lucide-react'
import { useCommentCountSum } from '@/hooks/useAlertComments'

export function CommentCountBadge({ count, scope = '' }: { count: number; scope?: string }) {
  const label = `${count} ${count === 1 ? 'comment' : 'comments'}${scope}`
  return (
    <span
      data-testid="comment-count"
      className="inline-flex items-center gap-0.5 text-xs font-normal text-muted-foreground tabular-nums"
      title={label}
      aria-label={label}
    >
      <MessageSquare className="h-3 w-3" aria-hidden="true" />
      {count}
    </span>
  )
}

// Group header of the list view: the sum over the group's alerts, so a collapsed group still shows it.
export function GroupCommentCountBadge({ alerts }: { alerts: { fingerprint: string; clusterName: string }[] }) {
  const count = useCommentCountSum(alerts)
  return count > 0 ? <CommentCountBadge count={count} scope=" in this group" /> : null
}
