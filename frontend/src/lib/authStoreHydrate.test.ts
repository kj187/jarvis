import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/client', () => ({
  fetchAuthInfo: vi.fn(),
  fetchAuthMe: vi.fn(),
  postLogout: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
}))

import { fetchAuthInfo, fetchAuthMe } from '@/api/client'
import { AuthUnavailableError } from '@/lib/authMe'
import { useAuthStore } from '@/store/authStore'

const info = { mode: 'internal', authMode: 'write_protect', setupRequired: false }

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(fetchAuthInfo).mockReset()
  vi.mocked(fetchAuthMe).mockReset()
  useAuthStore.setState({ user: null, providerInfo: null, isAuthenticated: false, isLoading: true, authError: false })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('authStore.hydrate', () => {
  it('keeps the provider info when only /auth/me is unavailable', async () => {
    vi.mocked(fetchAuthInfo).mockResolvedValue(info as never)
    vi.mocked(fetchAuthMe).mockRejectedValue(new AuthUnavailableError())
    const p = useAuthStore.getState().hydrate()
    await vi.advanceTimersByTimeAsync(10_000)
    await p
    const s = useAuthStore.getState()
    expect(s.authError).toBe(true)
    expect(s.providerInfo).toEqual(info)
    expect(s.isAuthenticated).toBe(false)
  })

  it('runs at most one retry chain at a time', async () => {
    vi.mocked(fetchAuthInfo).mockResolvedValue(info as never)
    vi.mocked(fetchAuthMe).mockRejectedValue(new AuthUnavailableError())
    const first = useAuthStore.getState().hydrate()
    const second = useAuthStore.getState().hydrate()
    await vi.advanceTimersByTimeAsync(10_000)
    await Promise.all([first, second])
    // 1 initial + 5 retries for ONE chain (not two).
    expect(vi.mocked(fetchAuthMe)).toHaveBeenCalledTimes(6)
  })

  it('clears the error once the backend answers', async () => {
    vi.mocked(fetchAuthInfo).mockResolvedValue(info as never)
    vi.mocked(fetchAuthMe).mockResolvedValue(null)
    useAuthStore.setState({ authError: true })
    await useAuthStore.getState().hydrate()
    expect(useAuthStore.getState().authError).toBe(false)
  })
})
