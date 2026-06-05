import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'
import { Trash2, Send } from 'lucide-react'
import { useAlertComments, useAddComment, useDeleteComment } from '@/hooks/useAlertComments'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'

const USERNAME_KEY = 'jarvis-username'

interface AlertCommentsProps {
  fingerprint: string
}

export function AlertComments({ fingerprint }: AlertCommentsProps) {
  const { data: comments = [], isLoading } = useAlertComments(fingerprint)
  const addMutation = useAddComment(fingerprint)
  const deleteMutation = useDeleteComment(fingerprint)

  const [authorName, setAuthorName] = useState(
    () => localStorage.getItem(USERNAME_KEY) ?? '',
  )
  const [body, setBody] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!authorName.trim() || !body.trim()) return
    localStorage.setItem(USERNAME_KEY, authorName.trim())
    addMutation.mutate(
      { authorName: authorName.trim(), body: body.trim() },
      { onSuccess: () => setBody('') },
    )
  }

  return (
    <div className="space-y-3">
      {isLoading && (
        <p className="text-xs text-muted-foreground">Laden…</p>
      )}

      {comments.length === 0 && !isLoading && (
        <p className="text-xs text-muted-foreground">Noch keine Kommentare.</p>
      )}

      {comments.map((c) => (
        <div key={c.id} className="rounded border border-border bg-accent/20 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">{c.authorName}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true, locale: de })}
              </span>
              <button
                onClick={() => deleteMutation.mutate(c.id)}
                className="cursor-pointer text-muted-foreground hover:text-destructive"
                aria-label="Kommentar löschen"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
          <p className="mt-1 text-sm whitespace-pre-wrap">{c.body}</p>
        </div>
      ))}

      {/* Comment form */}
      <form onSubmit={handleSubmit} className="space-y-2">
        <Input
          value={authorName}
          onChange={(e) => setAuthorName(e.target.value)}
          placeholder="Dein Name"
          className="h-8 text-xs"
          required
        />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Kommentar schreiben…"
          className="text-sm"
          rows={3}
          required
        />
        <Button
          type="submit"
          size="sm"
          disabled={!authorName.trim() || !body.trim() || addMutation.isPending}
          className="w-full"
        >
          <Send className="mr-1.5 h-3 w-3" />
          Senden
        </Button>
      </form>
    </div>
  )
}
