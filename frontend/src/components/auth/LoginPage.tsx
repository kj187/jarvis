import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { postLogin } from '@/api/client'
import { useAuthStore } from '@/store/authStore'

export function LoginPage() {
  const { providerInfo, setUser } = useAuthStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleInternalLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await postLogin(username, password)
      setUser(result.user)
    } catch {
      setError('Invalid username or password.')
    } finally {
      setLoading(false)
    }
  }

  const mode = providerInfo?.mode ?? null

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Jarvis</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>

        {mode === 'internal' && (
          <form onSubmit={handleInternalLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="login-username">Username</label>
              <Input
                id="login-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                autoComplete="username"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="login-password">Password</label>
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !username || !password}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        )}

        {mode === 'oidc' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground text-center">
              Sign in via your organization's SSO provider.
            </p>
            <Button
              className="w-full"
              onClick={() => { window.location.href = providerInfo!.loginUrl }}
            >
              Sign in with SSO
            </Button>
          </div>
        )}

        {mode === null && (
          <p className="text-sm text-muted-foreground text-center">
            Loading…
          </p>
        )}
      </div>
    </div>
  )
}
