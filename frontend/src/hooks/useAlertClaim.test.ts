import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useActiveClaim, useClaimHistory, useSetClaim, useReleaseClaim } from './useAlertClaim'
import * as client from '@/api/client'

vi.mock('@/api/client', () => ({
  fetchActiveClaim: vi.fn(),
  fetchClaimHistory: vi.fn(),
  setClaim: vi.fn(),
  releaseClaim: vi.fn(),
}))

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useActiveClaim', () => {
  it('returns claim on success', async () => {
    const claim = { id: 1, claimedBy: 'alice', note: '' }
    vi.mocked(client.fetchActiveClaim).mockResolvedValue(claim as never)

    const { result } = renderHook(() => useActiveClaim('abc123'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(claim)
  })

  it('returns null when no active claim', async () => {
    vi.mocked(client.fetchActiveClaim).mockResolvedValue(null)

    const { result } = renderHook(() => useActiveClaim('abc123'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })

  it('does not fetch when fingerprint is empty', async () => {
    renderHook(() => useActiveClaim(''), { wrapper: createWrapper() })
    await new Promise((r) => setTimeout(r, 50))
    expect(client.fetchActiveClaim).not.toHaveBeenCalled()
  })
})

describe('useClaimHistory', () => {
  it('returns claim history on success', async () => {
    const claims = [{ id: 1, claimedBy: 'alice' }, { id: 2, claimedBy: 'bob' }]
    vi.mocked(client.fetchClaimHistory).mockResolvedValue(claims as never)

    const { result } = renderHook(() => useClaimHistory('abc123'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(claims)
  })
})

describe('useSetClaim', () => {
  it('calls setClaim with correct args on mutate', async () => {
    const claim = { id: 1, claimedBy: 'alice', note: 'looking' }
    vi.mocked(client.setClaim).mockResolvedValue(claim as never)

    const { result } = renderHook(() => useSetClaim('abc123'), { wrapper: createWrapper() })

    await act(async () => {
      result.current.mutate({ claimedBy: 'alice', note: 'looking' })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.setClaim).toHaveBeenCalledWith('abc123', { claimedBy: 'alice', note: 'looking' })
  })

  it('enters error state on failure', async () => {
    vi.mocked(client.setClaim).mockRejectedValue(new Error('claim failed'))

    const { result } = renderHook(() => useSetClaim('abc123'), { wrapper: createWrapper() })
    await act(async () => {
      result.current.mutate({ claimedBy: 'alice' })
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('useReleaseClaim', () => {
  it('calls releaseClaim with by param', async () => {
    vi.mocked(client.releaseClaim).mockResolvedValue(undefined)

    const { result } = renderHook(() => useReleaseClaim('abc123'), { wrapper: createWrapper() })
    await act(async () => {
      result.current.mutate('alice')
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.releaseClaim).toHaveBeenCalledWith('abc123', 'alice')
  })
})
