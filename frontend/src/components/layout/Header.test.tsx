import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Header } from './Header'
import { useUIStore } from '@/store/uiStore'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/api/client', () => ({
  fetchClusters: vi.fn().mockResolvedValue([
    {
      name: 'homelab',
      alertmanagerUrl: 'http://alertmanager:9093',
      prometheusUrl: 'http://prometheus:9090',
      healthy: true,
      alertCount: 30,
    },
  ]),
  fetchAlerts: vi.fn().mockResolvedValue([]),
  fetchInfo: vi.fn().mockResolvedValue({ version: 'dev' }),
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function renderHeader() {
  const client = makeClient()
  return render(
    <QueryClientProvider client={client}>
      <Header />
    </QueryClientProvider>,
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  useUIStore.setState({
    activePage: 'alerts',
    filters: { state: '', search: '', labelMatchers: [] },
    wsConnected: false,
    pollingPaused: false,
    alertCounts: { filtered: 0, total: 0, byState: { active: 0, suppressed: 0, resolved: 0 }, silenceCount: 0 },
  })
})

describe('Header – silence button', () => {
  it('renders Create silence button', () => {
    renderHeader()
    expect(screen.getByText('Create silence')).toBeInTheDocument()
  })

  it('opens silence form when "Create silence" is clicked', async () => {
    renderHeader()
    await userEvent.click(screen.getByText('Create silence'))
    // Sheet opens with tabs; "Templates" tab is only visible when the sheet is open
    expect(screen.getByRole('button', { name: 'Templates' })).toBeInTheDocument()
  })
})

describe('Header – nav pills', () => {
  it('renders nav pills', () => {
    renderHeader()
    expect(screen.getByText('Alerts')).toBeInTheDocument()
    expect(screen.getByText('Silences')).toBeInTheDocument()
    expect(screen.queryByText('Resolved')).not.toBeInTheDocument()
    expect(screen.queryByText('Suppressed')).not.toBeInTheDocument()
    expect(screen.queryByText('All')).not.toBeInTheDocument()
  })

  it('navigates to alerts page on Alerts pill click', async () => {
    useUIStore.setState({ activePage: 'silences', filters: { state: 'active', search: '', labelMatchers: [] } })
    renderHeader()
    await userEvent.click(screen.getByText('Alerts'))
    expect(useUIStore.getState().activePage).toBe('alerts')
  })

  it('navigates to silences page on Silences pill click', async () => {
    renderHeader()
    await userEvent.click(screen.getByText('Silences'))
    expect(useUIStore.getState().activePage).toBe('silences')
  })
})


describe('Header – cluster popover', () => {
  it('shows cluster status badge', async () => {
    renderHeader()
    await waitFor(() => {
      expect(screen.getByLabelText('Instances 1/1')).toBeInTheDocument()
    })
  })

  it('shows cluster popover on mouse enter', async () => {
    renderHeader()
    await waitFor(() => screen.getByLabelText('Instances 1/1'))
    fireEvent.mouseEnter(screen.getByLabelText('Instances 1/1').parentElement!)
    expect(screen.getByText('Connected Instances')).toBeInTheDocument()
    expect(screen.getByText('homelab')).toBeInTheDocument()
    expect(screen.getByText('30 Alerts')).toBeInTheDocument()
    expect(screen.getByText('http://alertmanager:9093')).toBeInTheDocument()
  })

  it('hides cluster popover on mouse leave', async () => {
    renderHeader()
    await waitFor(() => screen.getByLabelText('Instances 1/1'))
    vi.useFakeTimers()
    const wrapper = screen.getByLabelText('Instances 1/1').parentElement!
    fireEvent.mouseEnter(wrapper)
    expect(screen.getByText('Connected Instances')).toBeInTheDocument()
    fireEvent.mouseLeave(wrapper)
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.queryByText('Connected Instances')).not.toBeInTheDocument()
    vi.useRealTimers()
  })
})

describe('Header – refresh button', () => {
  it('shows refresh button', () => {
    renderHeader()
    expect(screen.getByTitle('Refresh now')).toBeInTheDocument()
  })
})

describe('Header – alert count', () => {
  it('shows active count in Alerts pill, not suppressed or resolved', () => {
    useUIStore.setState({ alertCounts: { filtered: 3, total: 30, byState: { active: 5, suppressed: 2, resolved: 10 }, silenceCount: 3 } })
    renderHeader()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.queryByText('2')).not.toBeInTheDocument()
    expect(screen.queryByText('10')).not.toBeInTheDocument()
  })
})
