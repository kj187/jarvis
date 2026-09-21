import { useState } from 'react'
import { Check, Copy, Shield, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useFormatTime } from '@/hooks/useFormatTime'
import { copyText } from '@/lib/clipboard'
import type { AuthUser } from '@/types'

/**
 * Who Jarvis thinks the signed-in SSO user is: name, e-mail, role and the groups
 * the IdP reported. Groups drive what a user may see, so this is what to ask for
 * when someone reports a missing alert ("send me your groups").
 */
export function AccountDetails({ user }: { user: AuthUser }) {
  const formatTime = useFormatTime()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const groups = user.groups ?? []

  async function copyGroups() {
    setCopyState((await copyText(groups.join('\n'))) ? 'copied' : 'failed')
    window.setTimeout(() => setCopyState('idle'), 2500)
  }

  return (
    <dl className="space-y-2 text-sm" data-testid="account-details">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-muted-foreground">User</dt>
        <dd className="min-w-0 truncate font-medium">{user.username}</dd>
      </div>
      {user.email && (
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">E-mail</dt>
          <dd className="min-w-0 truncate">{user.email}</dd>
        </div>
      )}
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-muted-foreground">Role</dt>
        <dd>
          <span
            data-testid="account-role"
            className={cn(
              'inline-flex items-center gap-1 rounded-control border px-2 py-0.5 text-xs font-semibold',
              user.role === 'admin'
                ? 'border-info-edge bg-info-soft text-info-fg'
                : 'border-border bg-muted text-muted-foreground',
            )}
          >
            {user.role === 'admin' ? <Shield className="h-3 w-3" /> : <User className="h-3 w-3" />}
            {user.role === 'admin' ? 'Admin' : 'User'}
          </span>
        </dd>
      </div>

      <div className="space-y-1.5">
        <dt className="text-muted-foreground">Groups</dt>
        <dd className="space-y-1.5">
          {user.groupsClaim === undefined ? (
            <p className="text-[11px] text-muted-foreground">
              Not read — set JARVIS_OIDC_GROUPS_CLAIM to the token claim that carries the groups.
            </p>
          ) : groups.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No groups in the <span className="font-mono">{user.groupsClaim}</span> claim.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5" aria-label="Groups">
              {groups.map((g) => (
                <li key={g}>
                  <Badge variant="secondary" className="font-mono font-normal">
                    {g}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {user.groupsClaim !== undefined && (
            <div className="flex items-start justify-between gap-3">
              <p className="text-[10px] text-muted-foreground">
                From claim <span className="font-mono">{user.groupsClaim}</span>
                {user.lastLoginAt ? `, as of your last login (${formatTime(user.lastLoginAt)})` : ''}.
                Changes in the identity provider apply after you sign in again.
              </p>
              {groups.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 gap-1 px-2 text-[11px]"
                  onClick={copyGroups}
                  aria-label="Copy groups"
                >
                  {copyState === 'copied' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  <span role="status">
                    {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
                  </span>
                </Button>
              )}
            </div>
          )}
        </dd>
      </div>
    </dl>
  )
}
