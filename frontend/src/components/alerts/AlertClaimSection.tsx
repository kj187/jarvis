import { formatDistanceToNow } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { User } from 'lucide-react'
import { useActiveClaim, useSetClaim, useReleaseClaim } from '@/hooks/useAlertClaim'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LoginModal } from '@/components/auth/LoginModal'
import { useProtectedAction } from '@/hooks/useProtectedAction'
import { useAuthStore } from '@/store/authStore'
import { useState, useCallback } from 'react'
import { useSettingsStore } from '@/store/useSettingsStore'
import { cn } from '@/lib/utils'

interface AlertClaimSectionProps {
  fingerprint: string
  clusterName: string
}

export function AlertClaimSection({ fingerprint, clusterName }: AlertClaimSectionProps) {
  const { data: activeClaim, isLoading } = useActiveClaim(fingerprint, clusterName)
  const setClaimMutation = useSetClaim(fingerprint, clusterName)
  const releaseMutation = useReleaseClaim(fingerprint, clusterName)
  const { user, providerInfo } = useAuthStore()
  const authMode = providerInfo?.mode ?? 'none'

  const theme = useSettingsStore((s) => s.theme)
  const [note, setNote] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [manualName, setManualName] = useState('')

  const claimedBy = user?.username ?? manualName

  const claimAction = useCallback(
    () => setClaimMutation.mutateAsync({ claimedBy, note: note.trim() || undefined }),
    [setClaimMutation, claimedBy, note],
  )
  const releaseAction = useCallback(
    () => releaseMutation.mutateAsync(claimedBy || 'unknown'),
    [releaseMutation, claimedBy],
  )

  const { execute: executeClaim, loginModalOpen: claimModalOpen, onLoginSuccess: onClaimLoginSuccess, onLoginClose: onClaimLoginClose } = useProtectedAction(claimAction)
  const { execute: executeRelease, loginModalOpen: releaseModalOpen, onLoginSuccess: onReleaseLoginSuccess, onLoginClose: onReleaseLoginClose } = useProtectedAction(releaseAction)

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>

  return (
    <>
      <div className="space-y-3">
        {activeClaim ? (
          <div className={cn(
            'rounded border p-3',
            theme === 'light' ? 'border-blue-200 bg-blue-50' : 'border-blue-800 bg-blue-950/40',
          )}>
            <div className="flex items-center justify-between">
              <span className={cn('flex items-center gap-2 text-sm font-semibold', theme === 'light' ? 'text-blue-700' : 'text-blue-300')}>
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
              onClick={executeRelease}
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
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  executeClaim()
                  setShowForm(false)
                }}
                className="space-y-2"
              >
                {authMode !== 'none' ? (
                  user ? (
                    <div className="flex items-center gap-1.5 h-8 px-2 rounded border border-border bg-muted text-xs text-muted-foreground">
                      <User className="h-3.5 w-3.5 shrink-0" />
                      <span>{user.username}</span>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Login required to claim this alert.</p>
                  )
                ) : (
                  <Input
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="Your name"
                    className="h-8 text-xs"
                    autoFocus
                  />
                )}
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Note (optional)"
                  className="h-8 text-xs"
                />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" className="flex-1" disabled={(authMode === 'none' && !claimedBy) || setClaimMutation.isPending}>
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

      <LoginModal open={claimModalOpen} onSuccess={onClaimLoginSuccess} onClose={onClaimLoginClose} />
      <LoginModal open={releaseModalOpen} onSuccess={onReleaseLoginSuccess} onClose={onReleaseLoginClose} />
    </>
  )
}
