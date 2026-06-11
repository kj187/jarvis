import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { postLogin } from '@/api/client'
import { useAuthStore } from '@/store/authStore'

interface LoginModalProps {
  open: boolean
  onSuccess: () => void
  onClose: () => void
}

export function LoginModal({ open, onSuccess, onClose }: LoginModalProps) {
  const { providerInfo, isLoading, setUser } = useAuthStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!open) return null

  async function handleInternalLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await postLogin(username, password)
      setUser(result.user)
      onSuccess()
    } catch {
      setError('Invalid username or password.')
    } finally {
      setLoading(false)
    }
  }

  const mode = providerInfo?.mode ?? null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Login"
    >
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Login required</h2>
          <button onClick={onClose} className="cursor-pointer text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

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
            <p className="text-sm text-muted-foreground">Login via your organization's SSO provider.</p>
            <Button
              className="w-full"
              onClick={() => { window.location.href = providerInfo!.loginUrl }}
            >
              Login with SSO
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
