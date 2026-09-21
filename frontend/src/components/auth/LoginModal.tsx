import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { postLogin } from '@/api/client'
import { loginErrorMessage } from '@/lib/loginError'
import { startSsoLogin } from '@/lib/ssoLogin'
import { useAuthStore } from '@/store/authStore'

interface LoginModalProps {
  open: boolean
  onClose: () => void
  /** False when the app cannot be used without logging in again (full_protect). */
  dismissible?: boolean
}

/**
 * Logging in never navigates away: a successful login updates the auth store,
 * which closes the prompt and releases the action that was waiting for it.
 */
export function LoginModal({ open, onClose, dismissible = true }: LoginModalProps) {
  const { providerInfo, isLoading, setUser, sessionExpired } = useAuthStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [waitingForSso, setWaitingForSso] = useState(false)

  if (!open) return null

  // Render via portal so the modal always escapes its DOM container
  // (e.g. <tr> in AlertListRow) and appears at document.body level.
  async function handleInternalLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await postLogin(username, password)
      setUser(result.user)
    } catch (err) {
      setError(loginErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const mode = providerInfo?.mode ?? null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Login"
    >
      <div className="absolute inset-0 bg-black/60" onClick={dismissible ? onClose : undefined} />
      <div data-testid="login-modal-panel" className="relative z-10 w-full max-w-sm rounded-surface border border-border bg-card p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">
            {sessionExpired ? 'Session expired' : 'Login required'}
          </h2>
          {dismissible && (
            <button
              onClick={onClose}
              aria-label="Close"
              className="cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {mode !== null && mode !== 'none' && (
          <p className="text-sm text-muted-foreground">
            Log in to continue — you stay on this page and pick up right where you left off.
          </p>
        )}

        {(mode === null || isLoading) && (
          <p className="text-sm text-muted-foreground">
            Loading authentication configuration…
          </p>
        )}

        {mode === 'none' && !isLoading && (
          <p className="text-sm text-muted-foreground">
            Authentication is not configured on this server.
          </p>
        )}

        {mode === 'internal' && !isLoading && (
          <form onSubmit={handleInternalLogin} className="space-y-3">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              autoComplete="username"
              required
              autoFocus
            />
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              required
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !username || !password}>
              {loading ? 'Logging in…' : 'Login'}
            </Button>
          </form>
        )}

        {mode === 'oidc' && !isLoading && (
          <div className="space-y-3">
            <Button
              className="w-full"
              disabled={waitingForSso}
              onClick={() => {
                setWaitingForSso(true)
                startSsoLogin(providerInfo!.loginUrl, () => setWaitingForSso(false))
              }}
            >
              {waitingForSso ? 'Waiting for SSO login…' : 'Login with SSO'}
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
