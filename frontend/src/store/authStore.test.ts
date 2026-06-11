import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAuthStore } from './authStore'

vi.mock('@/api/client', () => ({
  fetchAuthInfo: vi.fn(),
  fetchAuthMe: vi.fn(),
  postLogout: vi.fn().mockResolvedValue(undefined),
}))

import * as client from '@/api/client'

beforeEach(() => {
  useAuthStore.setState({ user: null, providerInfo: null, isAuthenticated: false, isLoading: true })
})

describe('authStore.hydrate', () => {
  it('sets user and providerInfo on success', async () => {
    vi.mocked(client.fetchAuthInfo).mockResolvedValue({ mode: 'internal', loginUrl: '' })
    vi.mocked(client.fetchAuthMe).mockResolvedValue({ id: 'u1', username: 'alice', role: 'admin', provider: 'internal' })

    await useAuthStore.getState().hydrate()

    expect(useAuthStore.getState().user?.username).toBe('alice')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().providerInfo?.mode).toBe('internal')
    expect(useAuthStore.getState().isLoading).toBe(false)
  })

  it('sets isAuthenticated=false when /auth/me returns null', async () => {
    vi.mocked(client.fetchAuthInfo).mockResolvedValue({ mode: 'none', loginUrl: '' })
    vi.mocked(client.fetchAuthMe).mockResolvedValue(null)

    await useAuthStore.getState().hydrate()

    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().isLoading).toBe(false)
  })
})

describe('authStore.logout', () => {
  it('clears user and isAuthenticated', async () => {
    useAuthStore.setState({
      user: { id: 'u1', username: 'alice', role: 'admin', provider: 'internal' },
      isAuthenticated: true,
    })
    await useAuthStore.getState().logout()
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})
