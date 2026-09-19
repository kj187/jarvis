import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LoginModal } from '@/components/auth/LoginModal'
import { useAuthStore } from '@/store/authStore'

/**
 * The one app-wide login dialog. Anything that needs a session — a guarded
 * button, a write that came back 401, the header's Login entry — asks the auth
 * store (`requestLogin`) instead of mounting its own modal, so the login always
 * happens on top of the current page and the caller carries on afterwards.
 *
 * With full_protect an expired session cannot be dismissed: nothing works
 * without it, but the page underneath stays mounted so nothing is lost.
 */
export function LoginPrompt() {
  const qc = useQueryClient()
  const loginPromptOpen = useAuthStore((s) => s.loginPromptOpen)
  const sessionExpired = useAuthStore((s) => s.sessionExpired)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const authMode = useAuthStore((s) => s.providerInfo?.authMode)
  const dismissLoginPrompt = useAuthStore((s) => s.dismissLoginPrompt)

  const blocking = authMode === 'full_protect' && sessionExpired && !isAuthenticated
  const open = loginPromptOpen || blocking

  // Data fetched under the old (or no) session may be stale or have failed with 401.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !open && isAuthenticated) void qc.invalidateQueries()
    wasOpen.current = open
  }, [open, isAuthenticated, qc])

  return <LoginModal open={open} onClose={dismissLoginPrompt} dismissible={!blocking} />
}
