import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useAlerts, useAlertGroups, useAlertHistory, useAlertStats, useRefreshAlerts } from './useAlerts'
import * as client from '@/api/client'
import { useUIStore } from '@/store/uiStore'

vi.mock('@/api/client', () => ({
  fetchAlerts: vi.fn(),
  fetchAlertGroups: vi.fn(),
  fetchAlertHistory: vi.fn(),
  fetchAlertStats: vi.fn(),
}))

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState({ pollingPaused: false })
})

describe('useAlerts', () => {
  it('returns alerts on success', async () => {
    const alerts = [{ fingerprint: 'abc123' }]
    vi.mocked(client.fetchAlerts).mockResolvedValue(alerts as never)

    const { result } = renderHook(() => useAlerts(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(alerts)
  })

  it('handles error state', async () => {
    vi.mocked(client.fetchAlerts).mockRejectedValue(new Error('network error'))

    const { result } = renderHook(() => useAlerts(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('passes params to fetchAlerts', async () => {
    vi.mocked(client.fetchAlerts).mockResolvedValue([])
    renderHook(() => useAlerts({ cluster: 'homelab', state: 'active' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(client.fetchAlerts).toHaveBeenCalledWith({ cluster: 'homelab', state: 'active' }))
  })
})

describe('useAlertGroups', () => {
  it('returns groups on success', async () => {
    const groups = [{ alertname: 'TestAlert', severity: 'critical', count: 1, alerts: [] }]
    vi.mocked(client.fetchAlertGroups).mockResolvedValue(groups as never)

    const { result } = renderHook(() => useAlertGroups(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(groups)
  })
})

describe('useAlertHistory', () => {
  it('returns history on success', async () => {
    const data = { events: [{ id: 1, status: 'firing' }], total: 1 }
    vi.mocked(client.fetchAlertHistory).mockResolvedValue(data as never)

    const { result } = renderHook(() => useAlertHistory('abc123'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(data)
  })

  it('does not fetch when fingerprint is empty', async () => {
    vi.mocked(client.fetchAlertHistory).mockResolvedValue({ events: [], total: 0 })

    renderHook(() => useAlertHistory(''), { wrapper: createWrapper() })
    await new Promise((r) => setTimeout(r, 50))
    expect(client.fetchAlertHistory).not.toHaveBeenCalled()
  })
})

describe('useAlertStats', () => {
  it('returns stats on success', async () => {
    const stats = { fingerprint: 'abc123', occurrenceCount: 2 }
    vi.mocked(client.fetchAlertStats).mockResolvedValue(stats as never)

    const { result } = renderHook(() => useAlertStats('abc123'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(stats)
  })

  it('does not fetch when fingerprint is empty', async () => {
    renderHook(() => useAlertStats(''), { wrapper: createWrapper() })
    await new Promise((r) => setTimeout(r, 50))
    expect(client.fetchAlertStats).not.toHaveBeenCalled()
  })
})

describe('useRefreshAlerts', () => {
  it('returns a function', () => {
    const { result } = renderHook(() => useRefreshAlerts(), { wrapper: createWrapper() })
    expect(typeof result.current).toBe('function')
  })
})
