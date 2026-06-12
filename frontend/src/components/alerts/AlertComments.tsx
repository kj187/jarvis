import { useState, useCallback } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { Trash2, Send } from 'lucide-react'
import { useAlertComments, useAddComment, useDeleteComment } from '@/hooks/useAlertComments'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { LoginModal } from '@/components/auth/LoginModal'
import { useProtectedAction } from '@/hooks/useProtectedAction'
import { useAuthStore } from '@/store/authStore'
import type { Comment } from '@/types'

interface AlertCommentsProps {
  fingerprint: string
}

// ── Single comment row (own hook scope per delete action) ─────────────────────

interface CommentRowProps {
  comment: Comment
  fingerprint: string
  user: import('@/types').AuthUser | null
  authMode: string
}

function CommentRow({ comment, fingerprint, user, authMode }: CommentRowProps) {
  const deleteMutation = useDeleteComment(fingerprint)

  const deleteAction = useCallback(
    () => deleteMutation.mutateAsync(comment.id),
    [deleteMutation, comment.id],
  )
  const { execute: execDelete, loginModalOpen, onLoginSuccess, onLoginClose } = useProtectedAction(deleteAction)

  // Show delete only for the comment's own author.
  // Prefer user_id comparison (robust against username changes); fall back to
  // authorName for legacy comments that pre-date the user_id column.
  const canDelete =
    authMode === 'none' ||
    (user !== null &&
      (comment.userId != null ? comment.userId === user.id : comment.authorName === user.username))

  return (
    <>
      <div className="rounded border border-border bg-accent/20 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">{comment.authorName}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true, locale: enUS })}
            </span>
            {canDelete && (
              <button
                onClick={execDelete}
                className="cursor-pointer text-muted-foreground hover:text-destructive"
                aria-label="Delete comment"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        <p className="mt-1 text-sm whitespace-pre-wrap">{comment.body}</p>
      </div>
      <LoginModal open={loginModalOpen} onSuccess={onLoginSuccess} onClose={onLoginClose} />
    </>
  )
}

// ── AlertComments ─────────────────────────────────────────────────────────────

export function AlertComments({ fingerprint }: AlertCommentsProps) {
  const { data: comments = [], isLoading } = useAlertComments(fingerprint)
  const addMutation = useAddComment(fingerprint)
  const { user, providerInfo } = useAuthStore()
  const authMode = providerInfo?.mode ?? 'none'

  const [body, setBody] = useState('')
  const [manualAuthor, setManualAuthor] = useState('')

  const authorName = user?.username ?? manualAuthor

  const addAction = useCallback(
    () => addMutation.mutateAsync({ authorName, body: body.trim() }).then(() => setBody('')),
    [addMutation, authorName, body],
  )

  const { execute: executeAdd, loginModalOpen, onLoginSuccess, onLoginClose } = useProtectedAction(addAction)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    if (authMode === 'none' && !authorName) return
    executeAdd()
  }

  return (
    <>
      <div className="space-y-3">
        {isLoading && (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}

        {comments.length === 0 && !isLoading && (
          <p className="text-xs text-muted-foreground">No comments yet.</p>
        )}

        {comments.map((c) => (
          <CommentRow key={c.id} comment={c} fingerprint={fingerprint} user={user} authMode={authMode} />
        ))}

        {/* Comment form */}
        <form onSubmit={handleSubmit} className="space-y-2">
          {authMode !== 'none' ? (
            user ? (
              <div className="flex items-center gap-1.5 h-8 px-2 rounded border border-border bg-muted text-xs text-muted-foreground">
                <span>Commenting as <strong className="text-foreground">{user.username}</strong></span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Login required to comment.</p>
            )
          ) : (
            <Input
              value={manualAuthor}
              onChange={(e) => setManualAuthor(e.target.value)}
              placeholder="Your name"
              className="h-8 text-xs"
            />
          )}
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a comment…"
            className="text-sm"
            rows={3}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!body.trim() || (authMode === 'none' && !authorName) || addMutation.isPending}
            className="w-full"
          >
            <Send className="mr-1.5 h-3 w-3" />
            Send
          </Button>
        </form>
      </div>

      <LoginModal open={loginModalOpen} onSuccess={onLoginSuccess} onClose={onLoginClose} />
    </>
  )
}
