import { useCallback, useRef, useState } from 'react'
import { useAuthStore } from '@/store/authStore'

interface UseLoginGuardResult {
  guard: (action: () => unknown) => void
  loginModalOpen: boolean
  onLoginSuccess: () => void
  onLoginClose: () => void
}

/**
 * Returns a `guard(action)` function that executes the action immediately when
 * the user is authenticated (or auth is disabled), and shows the LoginModal
 * otherwise. After a successful login the pending action is re-executed.
 *
 * Unlike `useProtectedAction`, the action is passed at call-site rather than
 * at hook-creation time, which lets a single hook instance cover many write
 * actions within one component.
 */
export function useLoginGuard(): UseLoginGuardResult {
  const { isAuthenticated, providerInfo, isLoading } = useAuthStore()
  const [loginModalOpen, setLoginModalOpen] = useState(false)
  const pendingActionRef = useRef<(() => unknown) | null>(null)

  const guard = useCallback((action: () => unknown) => {
    if (isLoading || providerInfo === null) return
    if (providerInfo.mode === 'none') { action(); return }
    if (!isAuthenticated) {
      pendingActionRef.current = action
      setLoginModalOpen(true)
      return
    }
    action()
  }, [isAuthenticated, providerInfo, isLoading])

  const onLoginSuccess = useCallback(() => {
    setLoginModalOpen(false)
    const pending = pendingActionRef.current
    pendingActionRef.current = null
    pending?.()
  }, [])

  const onLoginClose = useCallback(() => {
    setLoginModalOpen(false)
    pendingActionRef.current = null
  }, [])

  return { guard, loginModalOpen, onLoginSuccess, onLoginClose }
}
