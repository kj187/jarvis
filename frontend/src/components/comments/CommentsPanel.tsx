import { useState, useCallback, useEffect, Suspense, lazy } from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { Trash2, Send, ChevronLeft, ChevronRight, ArrowUp } from 'lucide-react'
import { useAlertComments, useAddComment, useDeleteComment, COMMENTS_PAGE_SIZE } from '@/hooks/useAlertComments'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip } from '@/components/ui/tooltip'
import { LoginModal } from '@/components/auth/LoginModal'
import { useProtectedAction } from '@/hooks/useProtectedAction'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'
import { tzAbbr } from '@/lib/alertUtils'
import type { AuthUser, Comment } from '@/types'

const CommentMarkdown = lazy(() => import('./CommentMarkdown'))

const MAX_COMMENT_LENGTH = 10_000
const LENGTH_COUNTER_THRESHOLD = 500 // show the remaining-chars counter once this close to the cap

interface CommentsPanelProps {
  fingerprint: string
  clusterName: string
}

// ── Single comment row (own hook scope per delete action) ─────────────────────

interface CommentRowProps {
  comment: Comment
  fingerprint: string
  clusterName: string
  user: AuthUser | null
  authMode: string
}

function CommentRow({ comment, fingerprint, clusterName, user, authMode }: CommentRowProps) {
  const deleteMutation = useDeleteComment(fingerprint, clusterName)

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
      <div data-testid="detail-comment-item" className="rounded border border-border bg-accent/20 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span data-testid="detail-comment-author" className="text-xs font-semibold">{comment.authorName}</span>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip
              content={`${format(new Date(comment.createdAt), 'yyyy-MM-dd HH:mm', { locale: enUS })} ${tzAbbr}`}
              side="bottom"
            >
              <span data-testid="detail-comment-timestamp" className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true, locale: enUS })}
              </span>
            </Tooltip>
            {canDelete && (
              <button
                data-testid="detail-comment-delete"
                onClick={execDelete}
                className="cursor-pointer text-muted-foreground hover:text-destructive"
                aria-label="Delete comment"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        <div data-testid="detail-comment-body" className="mt-1">
          <Suspense fallback={<p className="text-sm whitespace-pre-wrap">{comment.body}</p>}>
            <CommentMarkdown body={comment.body} />
          </Suspense>
        </div>
      </div>
      <LoginModal open={loginModalOpen} onSuccess={onLoginSuccess} onClose={onLoginClose} />
    </>
  )
}

// ── CommentsPanel ─────────────────────────────────────────────────────────────

export function CommentsPanel({ fingerprint, clusterName }: CommentsPanelProps) {
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [fingerprint, clusterName])

  const { data, isLoading } = useAlertComments(fingerprint, clusterName, page)
  // Page 1 is kept warm in the background as a cheap "did new comments land
  // while I'm on page 2+?" signal — WS comment_added invalidation refreshes
  // its total independently of whatever page is currently on screen.
  const { data: latestPage } = useAlertComments(fingerprint, clusterName, 1)

  const comments = data?.comments ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / COMMENTS_PAGE_SIZE))
  const hasNewer = page > 1 && (latestPage?.total ?? total) > total

  const addMutation = useAddComment(fingerprint, clusterName)
  const { user, providerInfo } = useAuthStore()
  const authMode = providerInfo?.mode ?? 'none'

  const [body, setBody] = useState('')
  const [manualAuthor, setManualAuthor] = useState('')
  const [editorMode, setEditorMode] = useState<'write' | 'preview'>('write')

  const authorName = user?.username ?? manualAuthor

  const addAction = useCallback(
    () =>
      addMutation.mutateAsync({ authorName, body: body.trim() }).then(() => {
        setBody('')
        setEditorMode('write')
      }),
    [addMutation, authorName, body],
  )
  const { execute: executeAdd, loginModalOpen, onLoginSuccess, onLoginClose } = useProtectedAction(addAction)

  function handleSubmit(e?: React.SyntheticEvent) {
    e?.preventDefault()
    if (!body.trim() || body.length > MAX_COMMENT_LENGTH) return
    if (authMode === 'none' && !authorName) return
    executeAdd()
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  const remaining = MAX_COMMENT_LENGTH - body.length
  const canSubmit = Boolean(body.trim()) && remaining >= 0 && !(authMode === 'none' && !authorName) && !addMutation.isPending

  return (
    <div className="flex flex-col">
      <div className="space-y-3">
        {hasNewer && (
          <button
            data-testid="comments-jump-latest"
            onClick={() => setPage(1)}
            className="flex w-full items-center justify-center gap-1.5 rounded border border-link/40 bg-link/10 px-2 py-1.5 text-xs font-medium text-link hover:bg-link/15 cursor-pointer"
          >
            <ArrowUp className="h-3 w-3" />
            New comment — jump to latest
          </button>
        )}

        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {comments.length === 0 && !isLoading && (
          <p className="text-xs text-muted-foreground">No comments yet.</p>
        )}

        {comments.map((c) => (
          <CommentRow
            key={c.id}
            comment={c}
            fingerprint={fingerprint}
            clusterName={clusterName}
            user={user}
            authMode={authMode}
          />
        ))}

        {totalPages > 1 && (
          <div data-testid="comments-pager" className="flex items-center justify-center gap-3 pt-1 text-xs text-muted-foreground">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="cursor-pointer hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span data-testid="comments-pager-label">Page {page} of {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="cursor-pointer hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Comment form — pinned to the bottom of the column */}
      <form onSubmit={handleSubmit} className="mt-3 shrink-0 space-y-2 border-t border-border pt-3">
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

        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            data-testid="comment-editor-write-tab"
            onClick={() => setEditorMode('write')}
            className={cn(
              'cursor-pointer rounded px-2 py-1 font-medium',
              editorMode === 'write' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Write
          </button>
          <button
            type="button"
            data-testid="comment-editor-preview-tab"
            onClick={() => setEditorMode('preview')}
            className={cn(
              'cursor-pointer rounded px-2 py-1 font-medium',
              editorMode === 'preview' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Preview
          </button>
        </div>

        {editorMode === 'write' ? (
          <Textarea
            data-testid="detail-comment-input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            placeholder="Write a comment… (Markdown supported)"
            className="text-sm"
            rows={6}
          />
        ) : (
          <div data-testid="comment-editor-preview" className="min-h-[140px] rounded-md border border-input bg-background px-3 py-2">
            {body.trim() ? (
              <Suspense fallback={<p className="text-sm whitespace-pre-wrap">{body}</p>}>
                <CommentMarkdown body={body} />
              </Suspense>
            ) : (
              <p className="text-xs text-muted-foreground">Nothing to preview yet.</p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            **bold** · `code` · ```block``` · [link](url)
          </span>
          {remaining <= LENGTH_COUNTER_THRESHOLD && (
            <span data-testid="comment-length-counter" className={cn(remaining < 0 && 'text-destructive')}>
              {remaining} left
            </span>
          )}
        </div>

        <Button
          data-testid="detail-comment-submit"
          type="submit"
          size="sm"
          disabled={!canSubmit}
          className="w-full"
        >
          <Send className="mr-1.5 h-3 w-3" />
          Send
        </Button>
      </form>

      <LoginModal open={loginModalOpen} onSuccess={onLoginSuccess} onClose={onLoginClose} />
    </div>
  )
}
