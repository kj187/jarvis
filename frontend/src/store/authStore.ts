import { create } from 'zustand'
import { fetchAuthInfo, fetchAuthMe, postLogout, setUnauthorizedHandler } from '@/api/client'
import type { AuthUser, ProviderInfo } from '@/types'

interface AuthState {
  user: AuthUser | null
  providerInfo: ProviderInfo | null
  isAuthenticated: boolean
  isLoading: boolean
  setupRequired: boolean
  /** True once a session that was valid in this tab has since expired server-side. */
  sessionExpired: boolean
  /** Drives the single app-wide LoginModal (see `LoginPrompt`). */
  loginPromptOpen: boolean
  hydrate: () => Promise<void>
  setUser: (user: AuthUser | null) => void
  logout: () => Promise<void>
  /**
   * Resolves true immediately when no login is needed, otherwise opens the
   * login prompt and resolves true after a successful login, false when the
   * user dismisses it. Concurrent callers share one prompt.
   */
  requestLogin: () => Promise<boolean>
  dismissLoginPrompt: () => void
  /** The server rejected our session (401) — drop the stale user without navigating away. */
  expireSession: () => void
}

let pendingLogin: { promise: Promise<boolean>; resolve: (ok: boolean) => void } | null = null

function settleLogin(ok: boolean): void {
  pendingLogin?.resolve(ok)
  pendingLogin = null
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  providerInfo: null,
  isAuthenticated: false,
  isLoading: true,
  setupRequired: false,
  sessionExpired: false,
  loginPromptOpen: false,

  hydrate: async () => {
    set({ isLoading: true })
    const attempt = async (retries: number): Promise<void> => {
      try {
        const [providerInfo, user] = await Promise.all([fetchAuthInfo(), fetchAuthMe()])
        if (providerInfo.mode === 'internal' && providerInfo.setupRequired) {
          set({ providerInfo, setupRequired: true, isLoading: false })
          return
        }
        set({ providerInfo, user, isAuthenticated: user !== null, isLoading: false })
      } catch {
        if (retries > 0) {
          await new Promise((r) => setTimeout(r, 2000))
          return attempt(retries - 1)
        }
        set({ isLoading: false })
        // Backend unreachable after all retries — schedule one final attempt so the
        // login button appears without a manual reload once the backend comes up.
        setTimeout(() => get().hydrate(), 5000)
      }
    }
    await attempt(5)
  },

  setUser: (user) => {
    if (user === null) {
      set({ user, isAuthenticated: false })
      return
    }
    set({ user, isAuthenticated: true, sessionExpired: false, loginPromptOpen: false })
    settleLogin(true)
  },

  logout: async () => {
    await postLogout()
    set({ user: null, isAuthenticated: false, sessionExpired: false })
  },

  requestLogin: () => {
    const { isAuthenticated, providerInfo } = get()
    if (providerInfo === null) return Promise.resolve(false)
    if (providerInfo.mode === 'none' || isAuthenticated) return Promise.resolve(true)
    if (pendingLogin === null) {
      let resolve!: (ok: boolean) => void
      const promise = new Promise<boolean>((r) => { resolve = r })
      pendingLogin = { promise, resolve }
    }
    set({ loginPromptOpen: true })
    return pendingLogin.promise
  },

  dismissLoginPrompt: () => {
    set({ loginPromptOpen: false })
    settleLogin(false)
  },

  expireSession: () => {
    if (!get().isAuthenticated) return
    set({ user: null, isAuthenticated: false, sessionExpired: true })
  },
}))

// A 401 on a write (silence, claim, comment, …) means the session ran out while
// the user was working: ask them to log in right where they are and replay the
// request, so nothing they typed is lost. Reads only refresh the auth state — a
// background poll must not throw a dialog at the user (in full_protect App shows
// the prompt itself once `sessionExpired` is set).
setUnauthorizedHandler(async (method) => {
  const { expireSession, requestLogin } = useAuthStore.getState()
  expireSession()
  if (method === 'GET') return false
  return requestLogin()
})
