import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useProtectedAction } from './useProtectedAction'
import { useAuthStore } from '@/store/authStore'

vi.mock('@/api/client', () => ({
  fetchAuthInfo: vi.fn(),
  fetchAuthMe: vi.fn(),
  postLogout: vi.fn(),
}))

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    providerInfo: null,
    isAuthenticated: false,
    isLoading: false,
  })
})

describe('useProtectedAction', () => {
  it('executes action directly when authenticated', async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      providerInfo: { mode: 'internal', loginUrl: '' },
    })
    const action = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useProtectedAction(action))

    act(() => result.current.execute())
    expect(action).toHaveBeenCalledTimes(1)
    expect(result.current.loginModalOpen).toBe(false)
  })

  it('opens login modal when not authenticated (internal mode)', () => {
    useAuthStore.setState({
      isAuthenticated: false,
      providerInfo: { mode: 'internal', loginUrl: '' },
    })
    const action = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useProtectedAction(action))

    act(() => result.current.execute())
    expect(action).not.toHaveBeenCalled()
    expect(result.current.loginModalOpen).toBe(true)
  })

  it('executes action directly when mode is none (no modal)', () => {
    useAuthStore.setState({
      isAuthenticated: false,
      providerInfo: { mode: 'none', loginUrl: '' },
    })
    const action = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useProtectedAction(action))

    act(() => result.current.execute())
    expect(action).toHaveBeenCalledTimes(1)
    expect(result.current.loginModalOpen).toBe(false)
  })

  it('re-executes action after successful login', async () => {
    useAuthStore.setState({
      isAuthenticated: false,
      providerInfo: { mode: 'internal', loginUrl: '' },
    })
    const action = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useProtectedAction(action))

    act(() => result.current.execute())
    expect(result.current.loginModalOpen).toBe(true)

    await act(async () => result.current.onLoginSuccess())
    expect(action).toHaveBeenCalledTimes(1)
    expect(result.current.loginModalOpen).toBe(false)
  })

  it('closes modal and cancels pending action on close', () => {
    useAuthStore.setState({
      isAuthenticated: false,
      providerInfo: { mode: 'internal', loginUrl: '' },
    })
    const action = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useProtectedAction(action))

    act(() => result.current.execute())
    act(() => result.current.onLoginClose())
    expect(result.current.loginModalOpen).toBe(false)
    act(() => result.current.onLoginSuccess())
    expect(action).not.toHaveBeenCalled()
  })
})
