import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useAlertComments, useAddComment, useDeleteComment } from './useAlertComments'
import * as client from '@/api/client'

vi.mock('@/api/client', () => ({
  fetchComments: vi.fn(),
  addComment: vi.fn(),
  deleteComment: vi.fn(),
}))

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useAlertComments', () => {
  it('returns comments on success', async () => {
    const comments = [{ id: 1, authorName: 'alice', body: 'looks fine' }]
    vi.mocked(client.fetchComments).mockResolvedValue(comments as never)

    const { result } = renderHook(() => useAlertComments('abc123'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(comments)
  })

  it('does not fetch when fingerprint is empty', async () => {
    renderHook(() => useAlertComments(''), { wrapper: createWrapper() })
    await new Promise((r) => setTimeout(r, 50))
    expect(client.fetchComments).not.toHaveBeenCalled()
  })

  it('handles error state', async () => {
    vi.mocked(client.fetchComments).mockRejectedValue(new Error('server error'))

    const { result } = renderHook(() => useAlertComments('abc123'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('useAddComment', () => {
  it('calls addComment with correct args', async () => {
    const comment = { id: 1, authorName: 'alice', body: 'great find' }
    vi.mocked(client.addComment).mockResolvedValue(comment as never)

    const { result } = renderHook(() => useAddComment('abc123'), { wrapper: createWrapper() })
    await act(async () => {
      result.current.mutate({ authorName: 'alice', body: 'great find' })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.addComment).toHaveBeenCalledWith('abc123', { authorName: 'alice', body: 'great find' })
  })

  it('enters error state on failure', async () => {
    vi.mocked(client.addComment).mockRejectedValue(new Error('add failed'))

    const { result } = renderHook(() => useAddComment('abc123'), { wrapper: createWrapper() })
    await act(async () => {
      result.current.mutate({ authorName: 'alice', body: 'test' })
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('useDeleteComment', () => {
  it('calls deleteComment with id', async () => {
    vi.mocked(client.deleteComment).mockResolvedValue(undefined)

    const { result } = renderHook(() => useDeleteComment('abc123'), { wrapper: createWrapper() })
    await act(async () => {
      result.current.mutate(42)
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.deleteComment).toHaveBeenCalledWith('abc123', 42)
  })
})
