import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useWebSocket } from './useWebSocket'
import { useUIStore } from '@/store/uiStore'

// ── WebSocket Mock ────────────────────────────────────────────────────────────

type WsEventType = 'open' | 'close' | 'error' | 'message'

class MockWebSocket {
  static lastInstance: MockWebSocket | null = null
  url: string
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  readyState = 0

  constructor(url: string) {
    this.url = url
    MockWebSocket.lastInstance = this
  }

  send(_data: string) {}

  close() {
    this.readyState = 3
    this.onclose?.()
  }

  trigger(type: WsEventType, data?: string) {
    switch (type) {
      case 'open':
        this.readyState = 1
        this.onopen?.()
        break
      case 'close':
        this.readyState = 3
        this.onclose?.()
        break
      case 'error':
        this.onerror?.(new Error('ws error'))
        break
      case 'message':
        this.onmessage?.({ data: data ?? '' })
        break
    }
  }
}

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    qc,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
  }
}

beforeEach(() => {
  MockWebSocket.lastInstance = null
  vi.stubGlobal('WebSocket', MockWebSocket)
  useUIStore.setState({ wsConnected: false })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useWebSocket', () => {
  it('creates a WebSocket on mount', () => {
    const { wrapper } = createWrapper()
    renderHook(() => useWebSocket(), { wrapper })
    expect(MockWebSocket.lastInstance).not.toBeNull()
  })

  it('sets wsConnected to true on open', async () => {
    const { wrapper } = createWrapper()
    renderHook(() => useWebSocket(), { wrapper })

    await act(async () => {
      MockWebSocket.lastInstance?.trigger('open')
    })

    expect(useUIStore.getState().wsConnected).toBe(true)
  })

  it('sets wsConnected to false on close', async () => {
    vi.useFakeTimers()
    const { wrapper } = createWrapper()
    renderHook(() => useWebSocket(), { wrapper })

    await act(async () => {
      MockWebSocket.lastInstance?.trigger('open')
    })
    expect(useUIStore.getState().wsConnected).toBe(true)

    await act(async () => {
      MockWebSocket.lastInstance?.trigger('close')
    })
    expect(useUIStore.getState().wsConnected).toBe(false)
  })

  it('handles alerts_update message by patching query cache', async () => {
    const { wrapper, qc } = createWrapper()
    renderHook(() => useWebSocket(), { wrapper })

    const alerts = [{ fingerprint: 'abc123', status: { state: 'active' } }]
    const msg = JSON.stringify({ type: 'alerts_update', payload: { alerts } })

    await act(async () => {
      MockWebSocket.lastInstance?.trigger('open')
      MockWebSocket.lastInstance?.trigger('message', msg)
    })

    expect(qc.getQueryData(['alerts', undefined])).toEqual(alerts)
    expect(qc.getQueryData(['alerts', {}])).toEqual(alerts)
  })

  it('handles claim_set message by patching alerts cache', async () => {
    const { wrapper, qc } = createWrapper()
    renderHook(() => useWebSocket(), { wrapper })

    // Seed alerts cache with one alert
    const existingAlerts = [{ fingerprint: 'abc123', status: { state: 'active' }, activeClaim: null }]
    qc.setQueryData(['alerts', undefined], existingAlerts)

    const claim = { id: 1, claimedBy: 'alice' }
    const msg = JSON.stringify({ type: 'claim_set', payload: { fingerprint: 'abc123', claim } })

    await act(async () => {
      MockWebSocket.lastInstance?.trigger('open')
      MockWebSocket.lastInstance?.trigger('message', msg)
    })

    const cached = qc.getQueryData(['alerts', undefined]) as Array<{ fingerprint: string; activeClaim: unknown }>
    expect(cached[0].activeClaim).toEqual(claim)
  })

  it('handles claim_released message by clearing activeClaim', async () => {
    const { wrapper, qc } = createWrapper()
    renderHook(() => useWebSocket(), { wrapper })

    const existingAlerts = [{ fingerprint: 'abc123', activeClaim: { id: 1, claimedBy: 'alice' } }]
    qc.setQueryData(['alerts', undefined], existingAlerts)

    const msg = JSON.stringify({ type: 'claim_released', payload: { fingerprint: 'abc123', releasedBy: 'alice' } })

    await act(async () => {
      MockWebSocket.lastInstance?.trigger('open')
      MockWebSocket.lastInstance?.trigger('message', msg)
    })

    const cached = qc.getQueryData(['alerts', undefined]) as Array<{ fingerprint: string; activeClaim: unknown }>
    expect(cached[0].activeClaim).toBeUndefined()
  })

  it('ignores malformed JSON messages without throwing', async () => {
    const { wrapper } = createWrapper()
    renderHook(() => useWebSocket(), { wrapper })

    await act(async () => {
      MockWebSocket.lastInstance?.trigger('open')
      MockWebSocket.lastInstance?.trigger('message', 'not-valid-json')
    })

    // No crash — wsConnected still true
    expect(useUIStore.getState().wsConnected).toBe(true)
  })

  it('closes ws and clears timeout on unmount', async () => {
    vi.useFakeTimers()
    const { wrapper } = createWrapper()
    const { unmount } = renderHook(() => useWebSocket(), { wrapper })

    await act(async () => {
      MockWebSocket.lastInstance?.trigger('open')
    })

    const instance = MockWebSocket.lastInstance
    unmount()

    // After unmount, trigger close should not update store
    act(() => {
      instance?.trigger('close')
    })
    // wsConnected stays true because mountedRef is false after unmount
    expect(useUIStore.getState().wsConnected).toBe(true)
  })
})
