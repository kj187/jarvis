import { useCallback } from 'react'
import { useAuthStore } from '@/store/authStore'

/**
 * Returns a `guard(action)` function that runs the action immediately when the
 * user is authenticated (or auth is disabled). Otherwise it opens the app-wide
 * login prompt and runs the action once the user has logged in — right where
 * they were, nothing reloaded. Dismissing the prompt drops the action.
 *
 * Unlike `useProtectedAction`, the action is passed at call-site rather than
 * at hook-creation time, which lets a single hook instance cover many write
 * actions within one component.
 */
export function useLoginGuard(): { guard: (action: () => unknown) => void } {
  const requestLogin = useAuthStore((s) => s.requestLogin)

  const guard = useCallback((action: () => unknown) => {
    void requestLogin().then((ok) => { if (ok) action() })
  }, [requestLogin])

  return { guard }
}
