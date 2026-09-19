import { useCallback } from 'react'
import { useAuthStore } from '@/store/authStore'

/**
 * Wraps any async action. If the user is not authenticated, opens the app-wide
 * login prompt first and re-executes the action after a successful login.
 *
 * When provider mode == "none", no login is needed and the action runs directly.
 */
export function useProtectedAction<T>(action: () => Promise<T>): { execute: () => void } {
  const requestLogin = useAuthStore((s) => s.requestLogin)

  const execute = useCallback(() => {
    void requestLogin().then((ok) => { if (ok) void action() })
  }, [requestLogin, action])

  return { execute }
}
