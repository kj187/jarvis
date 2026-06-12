import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
    filters: { state: '', search: '', labelMatchers: [] },
    wsConnected: false,
    pollingPaused: false,
    alertCounts: { filtered: 0, total: 0, byState: { active: 0, suppressed: 0, resolved: 0 } },
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
    expect(screen.getByRole('heading', { name: 'Create silence' })).toBeInTheDocument()
  })
})

describe('Header – state filter pills', () => {
  it('renders state pills', () => {
    renderHeader()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Suppressed')).toBeInTheDocument()
    expect(screen.getByText('Resolved')).toBeInTheDocument()
  })

  it('toggles state filter on pill click', async () => {
    renderHeader()
    await userEvent.click(screen.getByText('Active'))
    expect(useUIStore.getState().filters.state).toBe('active')
  })

  it('deselects state filter when clicking active pill again', async () => {
    useUIStore.setState({ filters: { state: 'active', search: '', labelMatchers: [] } })
    renderHeader()
    await userEvent.click(screen.getByText('Active'))
    expect(useUIStore.getState().filters.state).toBe('')
  })
})

describe('Header – label filter', () => {
  it('adds a label matcher when inputs are filled and + clicked', async () => {
    renderHeader()
    await userEvent.type(screen.getAllByLabelText('Label name')[0], 'fstype')
    await userEvent.type(screen.getAllByLabelText('Label value')[0], 'ext4')
    await userEvent.click(screen.getAllByLabelText('Add filter')[0])
    expect(useUIStore.getState().filters.labelMatchers).toHaveLength(1)
    expect(useUIStore.getState().filters.labelMatchers[0]).toMatchObject({
      name: 'fstype',
      operator: '=',
      value: 'ext4',
    })
  })

  it('+ button is disabled when name or value is empty', () => {
    renderHeader()
    expect(screen.getAllByLabelText('Add filter')[0]).toBeDisabled()
  })

  it('shows active matchers row when matchers exist', () => {
    useUIStore.setState({
      filters: {
        state: '',
        search: '',
        labelMatchers: [{ id: '1', name: 'job', operator: '=', value: 'node' }],
      },
    })
    renderHeader()
    expect(screen.getAllByText('job')[0]).toBeInTheDocument()
    expect(screen.getAllByDisplayValue('node')[0]).toBeInTheDocument()
  })

  it('removes a matcher when X is clicked', async () => {
    useUIStore.setState({
      filters: {
        state: '',
        search: '',
        labelMatchers: [{ id: '1', name: 'job', operator: '=', value: 'node' }],
      },
    })
    renderHeader()
    await userEvent.click(screen.getAllByLabelText('Remove filter job=node')[0])
    expect(useUIStore.getState().filters.labelMatchers).toHaveLength(0)
  })

  it('shows multiple matchers when they exist', () => {
    useUIStore.setState({
      filters: {
        state: '',
        search: '',
        labelMatchers: [
          { id: '1', name: 'job', operator: '=', value: 'node' },
          { id: '2', name: 'env', operator: '=', value: 'prod' },
        ],
      },
    })
    renderHeader()
    expect(screen.getAllByDisplayValue('node')[0]).toBeInTheDocument()
    expect(screen.getAllByDisplayValue('prod')[0]).toBeInTheDocument()
  })
})

describe('Header – search', () => {
  it('search bar is not visible initially', () => {
    renderHeader()
    expect(screen.queryByLabelText('Search alerts')).not.toBeInTheDocument()
  })

  it('shows full-width search bar when search icon is clicked', async () => {
    renderHeader()
    await userEvent.click(screen.getByTitle('Search'))
    expect(screen.getByLabelText('Search alerts')).toBeInTheDocument()
  })

  it('closes search bar on Escape key', async () => {
    renderHeader()
    await userEvent.click(screen.getByTitle('Search'))
    const input = screen.getByLabelText('Search alerts')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByLabelText('Search alerts')).not.toBeInTheDocument()
  })

  it('updates search filter on typing', async () => {
    renderHeader()
    await userEvent.click(screen.getByTitle('Search'))
    await userEvent.type(screen.getByLabelText('Search alerts'), 'disk')
    expect(useUIStore.getState().filters.search).toBe('disk')
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
    const wrapper = screen.getByLabelText('Instances 1/1').parentElement!
    fireEvent.mouseEnter(wrapper)
    expect(screen.getByText('Connected Instances')).toBeInTheDocument()
    fireEvent.mouseLeave(wrapper)
    expect(screen.queryByText('Connected Instances')).not.toBeInTheDocument()
  })
})

describe('Header – refresh button', () => {
  it('shows refresh button', () => {
    renderHeader()
    expect(screen.getByTitle('Refresh now')).toBeInTheDocument()
  })
})

describe('Header – alert count', () => {
  it('shows active and suppressed counts, not resolved count', () => {
    useUIStore.setState({ alertCounts: { filtered: 3, total: 30, byState: { active: 5, suppressed: 2, resolved: 10 } } })
    renderHeader()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.queryByText('10')).not.toBeInTheDocument()
  })
})
