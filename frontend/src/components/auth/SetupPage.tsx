import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { postSetup, SetupError } from '@/api/client'
import { useAuthStore } from '@/store/authStore'

export function SetupPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const tokenRequired = useAuthStore((s) => s.providerInfo?.setupTokenRequired === true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const strength = password.length >= 20 ? 'Strong' : password.length >= 12 ? 'Fair' : 'Weak'
  const strengthColor = strength === 'Strong' ? 'text-success-fg' : strength === 'Fair' ? 'text-warning-fg' : 'text-critical-fg'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 12) {
      setError('Password must be at least 12 characters.')
      return
    }

    setLoading(true)
    try {
      await postSetup(username, password, tokenRequired ? setupToken : undefined)
      window.location.href = '/'
    } catch (err) {
      if (err instanceof SetupError && err.status === 401) {
        setError('The setup token is not correct.')
      } else if (err instanceof SetupError && err.status === 403) {
        setError('Setup was already completed. Reload the page to sign in.')
      } else {
        setError('Setup failed. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div data-testid="setup-page-card" className="w-full max-w-sm rounded-surface border border-border bg-card p-8 space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Jarvis</h1>
          <p className="text-sm text-muted-foreground">Initial setup</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="setup-username">Username</label>
            <Input
              id="setup-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              required
              autoFocus
              autoComplete="username"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="setup-password">Password</label>
            <Input
              id="setup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 12 characters"
              required
              autoComplete="new-password"
            />
            {password.length > 0 && (
              <p className={`text-xs ${strengthColor}`}>Strength: {strength}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="setup-confirm">Confirm password</label>
            <Input
              id="setup-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat password"
              required
              autoComplete="new-password"
            />
          </div>

          {tokenRequired && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="setup-token">Setup token</label>
              <Input
                id="setup-token"
                type="password"
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
                placeholder="JARVIS_SETUP_TOKEN"
                required
                autoComplete="off"
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading || !username || !password || !confirm || (tokenRequired && !setupToken)}>
            {loading ? 'Creating account…' : 'Create admin account'}
          </Button>
        </form>
      </div>
    </div>
  )
}
