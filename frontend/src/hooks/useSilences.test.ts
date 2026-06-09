import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useSilenceEvents, useSilences, useUpsertSilence, useDeleteSilence } from './useSilences'
import * as client from '@/api/client'

vi.mock('@/api/client', () => ({
  fetchSilences: vi.fn(),
  fetchSilenceEvents: vi.fn(),
  upsertSilence: vi.fn(),
  deleteSilence: vi.fn(),
  triggerPoll: vi.fn().mockResolvedValue(undefined),
}))

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useSilenceEvents', () => {
  it('returns silence events on success', async () => {
    const events = [{ id: 1, action: 'created', silenceId: 's1' }]
    vi.mocked(client.fetchSilenceEvents).mockResolvedValue(events as never)

    const { result } = renderHook(() => useSilenceEvents('abc123'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(events)
  })

  it('does not fetch when fingerprint is empty', async () => {
    renderHook(() => useSilenceEvents(''), { wrapper: createWrapper() })
    await new Promise((r) => setTimeout(r, 50))
    expect(client.fetchSilenceEvents).not.toHaveBeenCalled()
  })
})

describe('useSilences', () => {
  it('returns silences on success', async () => {
    const silences = [{ id: 'silence-1', comment: 'test' }]
    vi.mocked(client.fetchSilences).mockResolvedValue(silences as never)

    const { result } = renderHook(() => useSilences(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(silences)
  })

  it('passes cluster to fetchSilences when provided', async () => {
    vi.mocked(client.fetchSilences).mockResolvedValue([])
    renderHook(() => useSilences('homelab'), { wrapper: createWrapper() })
    await waitFor(() => expect(client.fetchSilences).toHaveBeenCalledWith('homelab'))
  })

  it('handles error state', async () => {
    vi.mocked(client.fetchSilences).mockRejectedValue(new Error('error'))

    const { result } = renderHook(() => useSilences(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('useUpsertSilence', () => {
  it('calls upsertSilence with body and triggers poll on success', async () => {
    vi.mocked(client.upsertSilence).mockResolvedValue({ id: 'new-silence' })

    const { result } = renderHook(() => useUpsertSilence(), { wrapper: createWrapper() })
    await act(async () => {
      result.current.mutate({
        cluster: 'homelab',
        matchers: [],
        startsAt: '2024-01-01T00:00:00Z',
        endsAt: '2024-01-01T01:00:00Z',
        createdBy: 'alice',
        comment: 'maintenance',
      })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.upsertSilence).toHaveBeenCalled()
    expect(client.triggerPoll).toHaveBeenCalled()
  })

  it('enters error state on failure', async () => {
    vi.mocked(client.upsertSilence).mockRejectedValue(new Error('create failed'))

    const { result } = renderHook(() => useUpsertSilence(), { wrapper: createWrapper() })
    await act(async () => {
      result.current.mutate({
        cluster: 'homelab',
        matchers: [],
        startsAt: '2024-01-01T00:00:00Z',
        endsAt: '2024-01-01T01:00:00Z',
        createdBy: 'alice',
        comment: 'test',
      })
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('useDeleteSilence', () => {
  it('calls deleteSilence with id and cluster', async () => {
    vi.mocked(client.deleteSilence).mockResolvedValue(undefined)

    const { result } = renderHook(() => useDeleteSilence(), { wrapper: createWrapper() })
    await act(async () => {
      result.current.mutate({ id: 'silence-1', cluster: 'homelab' })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.deleteSilence).toHaveBeenCalledWith('silence-1', 'homelab', {
      fingerprint: undefined,
      by: undefined,
    })
    expect(client.triggerPoll).toHaveBeenCalled()
  })

  it('passes optional fingerprint and by params', async () => {
    vi.mocked(client.deleteSilence).mockResolvedValue(undefined)

    const { result } = renderHook(() => useDeleteSilence(), { wrapper: createWrapper() })
    await act(async () => {
      result.current.mutate({ id: 'silence-1', cluster: 'homelab', fingerprint: 'abc123', by: 'alice' })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.deleteSilence).toHaveBeenCalledWith('silence-1', 'homelab', {
      fingerprint: 'abc123',
      by: 'alice',
    })
  })
})
