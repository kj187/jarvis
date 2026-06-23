import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AlertsPage } from './AlertsPage'
import { useUIStore } from '@/store/uiStore'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/hooks/useAlerts', () => ({
  useAlerts: vi.fn().mockReturnValue({ data: [], isLoading: false }),
}))

vi.mock('@/hooks/useSilences', () => ({
  useSilences: vi.fn().mockReturnValue({ data: [] }),
}))

vi.mock('@/components/alerts/AlertCardGrid', () => ({
  AlertCardGrid: () => <div>AlertCardGrid</div>,
}))

vi.mock('@/components/alerts/AlertListView', () => ({
  AlertListView: () => <div>AlertListView</div>,
}))

vi.mock('@/components/alerts/AlertDetailPanel', () => ({
  AlertDetailPanel: () => null,
}))

vi.mock('@/components/layout/MatcherChipsBar', () => ({
  MatcherChipsBar: () => null,
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: vi.fn((sel?: (s: unknown) => unknown) =>
    sel ? sel({ providerInfo: null }) : { providerInfo: null },
  ),
}))

vi.mock('./ViewToggle', () => ({
  ViewToggle: () => null,
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderPage() {
  const client = makeClient()
  return render(
    <QueryClientProvider client={client}>
      <AlertsPage />
    </QueryClientProvider>,
  )
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  useUIStore.setState({
    activePage: 'alerts',
    filters: { state: 'active', search: '', labelMatchers: [] },
    viewMode: 'card',
    activeViewMode: 'card',
    isFullscreen: false,
    wsConnected: false,
    pollingPaused: false,
    alertCounts: { filtered: 0, total: 0, byState: { active: 0, suppressed: 0, resolved: 0 }, silenceCount: 0 },
  })
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AlertsPage – label filter', () => {
  it('adds a label matcher when inputs are filled and + clicked', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('Label name'), 'fstype')
    await userEvent.type(screen.getByLabelText('Label value'), 'ext4')
    await userEvent.click(screen.getByLabelText('Add filter'))
    expect(useUIStore.getState().filters.labelMatchers).toHaveLength(1)
    expect(useUIStore.getState().filters.labelMatchers[0]).toMatchObject({
      name: 'fstype',
      operator: '=',
      value: 'ext4',
    })
  })

  it('+ button is disabled when name or value is empty', () => {
    renderPage()
    expect(screen.getByLabelText('Add filter')).toBeDisabled()
  })
})

describe('AlertsPage – search', () => {
  it('search bar is not visible initially', () => {
    renderPage()
    expect(screen.queryByLabelText('Search alerts')).not.toBeInTheDocument()
  })

  it('shows search bar when search icon is clicked', async () => {
    renderPage()
    await userEvent.click(screen.getByTitle('Search'))
    expect(screen.getByLabelText('Search alerts')).toBeInTheDocument()
  })

  it('closes search bar on Escape key', async () => {
    renderPage()
    await userEvent.click(screen.getByTitle('Search'))
    const input = screen.getByLabelText('Search alerts')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByLabelText('Search alerts')).not.toBeInTheDocument()
  })

  it('updates search filter on typing', async () => {
    renderPage()
    await userEvent.click(screen.getByTitle('Search'))
    await userEvent.type(screen.getByLabelText('Search alerts'), 'disk')
    expect(useUIStore.getState().filters.search).toBe('disk')
  })
})
