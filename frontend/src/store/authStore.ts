import { create } from 'zustand'
import { fetchAuthInfo, fetchAuthMe, postLogout } from '@/api/client'
import type { AuthUser, ProviderInfo } from '@/types'

interface AuthState {
  user: AuthUser | null
  providerInfo: ProviderInfo | null
  isAuthenticated: boolean
  isLoading: boolean
  setupRequired: boolean
  hydrate: () => Promise<void>
  setUser: (user: AuthUser | null) => void
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  providerInfo: null,
  isAuthenticated: false,
  isLoading: true,
  setupRequired: false,

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
          await new Promise((r) => setTimeout(r, 1500))
          return attempt(retries - 1)
        }
        set({ isLoading: false })
      }
    }
    await attempt(3)
  },

  setUser: (user) => {
    set({ user, isAuthenticated: user !== null })
  },

  logout: async () => {
    await postLogout()
    set({ user: null, isAuthenticated: false })
  },
}))
