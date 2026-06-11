import { useCallback, useRef, useState } from 'react'
import { useAuthStore } from '@/store/authStore'

interface UseProtectedActionResult {
  execute: () => void
  loginModalOpen: boolean
  onLoginSuccess: () => void
  onLoginClose: () => void
}

/**
 * Wraps any async action. If the user is not authenticated, opens the login
 * modal first. After login, re-executes the action automatically.
 *
 * When provider mode == "none", the action is never executed and no modal opens.
 * Callers should check providerInfo.mode and disable the button accordingly.
 */
export function useProtectedAction<T>(action: () => Promise<T>): UseProtectedActionResult {
  const { isAuthenticated, providerInfo, isLoading } = useAuthStore()
  const [loginModalOpen, setLoginModalOpen] = useState(false)
  const pendingRef = useRef(false)

  const execute = useCallback(() => {
    // Still loading auth state — ignore click, user can retry once loaded.
    if (isLoading || providerInfo === null) return
    // none mode: no auth required — execute directly.
    if (providerInfo.mode === 'none') {
      action()
      return
    }
    if (!isAuthenticated) {
      pendingRef.current = true
      setLoginModalOpen(true)
      return
    }
    action()
  }, [isAuthenticated, providerInfo, isLoading, action])

  const onLoginSuccess = useCallback(() => {
    setLoginModalOpen(false)
    if (pendingRef.current) {
      pendingRef.current = false
      action()
    }
  }, [action])

  const onLoginClose = useCallback(() => {
    setLoginModalOpen(false)
    pendingRef.current = false
  }, [])

  return { execute, loginModalOpen, onLoginSuccess, onLoginClose }
}
