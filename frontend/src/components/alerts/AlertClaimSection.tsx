import { formatDistanceToNow } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { User } from 'lucide-react'
import { useActiveClaim, useSetClaim, useReleaseClaim } from '@/hooks/useAlertClaim'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useState } from 'react'

const USERNAME_KEY = 'jarvis-username'

interface AlertClaimSectionProps {
  fingerprint: string
}

export function AlertClaimSection({ fingerprint }: AlertClaimSectionProps) {
  const { data: activeClaim, isLoading } = useActiveClaim(fingerprint)
  const setClaimMutation = useSetClaim(fingerprint)
  const releaseMutation = useReleaseClaim(fingerprint)

  const [claimedBy, setClaimedBy] = useState(
    () => localStorage.getItem(USERNAME_KEY) ?? '',
  )
  const [note, setNote] = useState('')
  const [showForm, setShowForm] = useState(false)

  function handleClaim(e: React.FormEvent) {
    e.preventDefault()
    if (!claimedBy.trim()) return
    localStorage.setItem(USERNAME_KEY, claimedBy.trim())
    setClaimMutation.mutate(
      { claimedBy: claimedBy.trim(), note: note.trim() || undefined },
      { onSuccess: () => setShowForm(false) },
    )
  }

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>

  return (
    <div className="space-y-3">
      {activeClaim ? (
        <div className="rounded border border-blue-800 bg-blue-950/40 p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold text-blue-300">
              <User className="h-4 w-4" />
              {activeClaim.claimedBy}
            </span>
            <span className="text-xs text-muted-foreground">
              for {formatDistanceToNow(new Date(activeClaim.claimedAt), { addSuffix: false, locale: enUS })}
            </span>
          </div>
          {activeClaim.note && (
            <p className="mt-1 text-xs text-muted-foreground">{activeClaim.note}</p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full text-xs"
            onClick={() =>
              releaseMutation.mutate(
                localStorage.getItem(USERNAME_KEY) ?? 'unknown',
              )
            }
            disabled={releaseMutation.isPending}
          >
            Release
          </Button>
        </div>
      ) : (
        <>
          {!showForm ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setShowForm(true)}
            >
              <User className="mr-1.5 h-4 w-4" />
              I'll take this
            </Button>
          ) : (
            <form onSubmit={handleClaim} className="space-y-2">
              <Input
                value={claimedBy}
                onChange={(e) => setClaimedBy(e.target.value)}
                placeholder="Your name"
                className="h-8 text-xs"
                required
              />
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note (optional)"
                className="h-8 text-xs"
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" className="flex-1" disabled={!claimedBy.trim() || setClaimMutation.isPending}>
                  Claim
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </>
      )}

    </div>
  )
}
