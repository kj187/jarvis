import { useState, useEffect } from 'react'
import { ShieldOff, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

const STORAGE_KEY = 'jarvis_noauth_notice_dismissed'

export function NoAuthNotice() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true)
    }
  }, [])

  function close() {
    setVisible(false)
  }

  function dismissForever() {
    localStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Authentication notice"
    >
      <div className="absolute inset-0 bg-black/60" onClick={close} />
      <div className="relative z-10 w-full max-w-md rounded-lg border border-amber-500/30 bg-card p-6 shadow-xl space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2 text-amber-500">
            <ShieldOff className="h-5 w-5 shrink-0" />
            <h2 className="text-base font-semibold">No authentication configured</h2>
          </div>
          <button onClick={close} className="cursor-pointer text-muted-foreground hover:text-foreground shrink-0 mt-0.5">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            Jarvis is running in <span className="font-mono text-foreground">JARVIS_AUTH_PROVIDER=none</span> mode.
            All write actions — claims, comments, and silences — are publicly accessible
            without any login. Anyone who can reach this URL can perform these actions.
          </p>
          <p>
            This is fine if you want it, but you should be aware of it.
          </p>
          <p>
            Two authentication providers are available:
          </p>
          <ul className="list-disc list-inside space-y-1 pl-1">
            <li>
              <span className="font-mono text-foreground">internal</span> — local user accounts
              with bcrypt passwords, managed via a built-in admin panel. A first-run wizard
              creates the admin account.
            </li>
            <li>
              <span className="font-mono text-foreground">oidc</span> — delegate login to an
              external provider (Keycloak, Authentik, etc.) using OIDC Authorization Code
              Flow with PKCE.
            </li>
          </ul>
          <p>
            Set <span className="font-mono text-foreground">JARVIS_AUTH_PROVIDER=internal</span> (or{' '}
            <span className="font-mono text-foreground">oidc</span>) and{' '}
            <span className="font-mono text-foreground">JARVIS_SECRET_KEY=&lt;32+ random bytes&gt;</span>{' '}
            in your <span className="font-mono text-foreground">.env</span> to get started.{' '}
            See the{' '}
            <a
              href="https://github.com/kj187/jarvis/blob/main/docs/authentication.md"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-foreground hover:text-amber-400 cursor-pointer"
            >
              authentication docs
            </a>{' '}
            for full setup instructions.
          </p>
        </div>

        <Button className="w-full" onClick={dismissForever}>
          Got it, don't show again
        </Button>
      </div>
    </div>
  )
}
