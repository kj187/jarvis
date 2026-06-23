import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import App from './App'
import { useUIStore, VIEW_MODE_KEY } from '@/store/uiStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { useAuthStore } from '@/store/authStore'

vi.mock('@/components/layout/Header', () => ({
  Header: () => <div>Header</div>,
}))

vi.mock('@/components/alerts/AlertsPage', () => ({
  AlertsPage: () => <div>Alerts</div>,
}))

vi.mock('@/components/auth/SetupPage', () => ({
  SetupPage: () => <div>Setup</div>,
}))

vi.mock('@/components/auth/NoAuthNotice', () => ({
  NoAuthNotice: () => <div>NoAuthNotice</div>,
}))

beforeEach(() => {
  localStorage.clear()
  useSettingsStore.setState({ defaultFilters: [], defaultViewMode: 'card' })
  useUIStore.setState({
    viewMode: 'card',
    selectedFingerprint: null,
    filters: { state: 'active', search: '', labelMatchers: [] },
    wsConnected: false,
    pollingPaused: false,
    alertCounts: { filtered: 0, total: 0, byState: { active: 0, suppressed: 0, resolved: 0 }, silenceCount: 0 },
  })
  useAuthStore.setState({
    user: null,
    providerInfo: null,
    isAuthenticated: false,
    isLoading: false,
    setupRequired: false,
  })
})

describe('App default view initialization', () => {
  it('keeps previously selected view mode from localStorage', async () => {
    localStorage.setItem(VIEW_MODE_KEY, 'list')
    useUIStore.setState({ viewMode: 'list' })
    useSettingsStore.setState({ defaultViewMode: 'card' })

    render(<App />)

    await waitFor(() => {
      expect(useUIStore.getState().viewMode).toBe('list')
    })
  })

  it('applies default view mode from settings when no localStorage value exists', async () => {
    useUIStore.setState({ viewMode: 'card' })
    useSettingsStore.setState({ defaultViewMode: 'list' })

    render(<App />)

    await waitFor(() => {
      expect(useUIStore.getState().viewMode).toBe('list')
    })
  })
})
