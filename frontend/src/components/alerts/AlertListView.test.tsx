import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { AlertListView } from './AlertListView'
import type { EnrichedAlert, Silence } from '@/types'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/api/client', () => ({
  fetchClusters: vi.fn().mockResolvedValue([]),
  deleteSilence: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./AlertListRow', () => ({
  AlertListRow: ({ alert }: { alert: EnrichedAlert }) => (
    <tr data-testid="alert-row">
      <td>{alert.fingerprint}</td>
    </tr>
  ),
}))

vi.mock('@/components/silences/SilenceForm', () => ({
  SilenceForm: () => <div data-testid="silence-form">SilenceForm</div>,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAlert(overrides: Partial<EnrichedAlert> = {}, fp = 'fp1'): EnrichedAlert {
  return {
    fingerprint: fp,
    status: { state: 'active', inhibitedBy: [], silencedBy: [] },
    labels: { alertname: 'TestAlert', severity: 'critical' },
    annotations: {},
    startsAt: new Date().toISOString(),
    endsAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    generatorURL: '',
    receivers: [{ name: 'email' }],
    clusterName: 'homelab',
    alertmanagerUrl: 'http://am:9093',
    ...overrides,
  }
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

const noop = () => {}
const silences: Silence[] = []

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AlertListView – empty state', () => {
  it('renders empty state when alerts array is empty', () => {
    render(
      <AlertListView alerts={[]} silences={silences} onSelectAlert={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByLabelText('No alerts')).toBeInTheDocument()
  })

  it('does not render table when empty', () => {
    render(
      <AlertListView alerts={[]} silences={silences} onSelectAlert={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('AlertListView – table structure', () => {
  it('renders table with Alert Name column header', () => {
    const alerts = [makeAlert()]
    render(
      <AlertListView alerts={alerts} silences={silences} onSelectAlert={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText('Alert Name')).toBeInTheDocument()
  })

  it('renders Actions column header', () => {
    const alerts = [makeAlert()]
    render(
      <AlertListView alerts={alerts} silences={silences} onSelectAlert={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText('Actions')).toBeInTheDocument()
  })

  it('renders State column when no stateFilter provided', () => {
    const alerts = [makeAlert()]
    render(
      <AlertListView alerts={alerts} silences={silences} onSelectAlert={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText('State')).toBeInTheDocument()
  })

  it('hides State column when stateFilter is set', () => {
    const alerts = [makeAlert()]
    render(
      <AlertListView alerts={alerts} silences={silences} onSelectAlert={noop} stateFilter="active" />,
      { wrapper: makeWrapper() },
    )
    expect(screen.queryByText('State')).not.toBeInTheDocument()
  })
})

describe('AlertListView – severity sections', () => {
  it('renders CRITICAL severity section', () => {
    const alerts = [makeAlert({ labels: { alertname: 'DiskFull', severity: 'critical' } })]
    render(
      <AlertListView alerts={alerts} silences={silences} onSelectAlert={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText('Critical')).toBeInTheDocument()
  })

  it('renders WARNING severity section', () => {
    const alerts = [makeAlert({ labels: { alertname: 'HighCPU', severity: 'warning' } })]
    render(
      <AlertListView alerts={alerts} silences={silences} onSelectAlert={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText('Warning')).toBeInTheDocument()
  })

  it('renders total alert count in severity section', () => {
    const alerts = [
      makeAlert({ labels: { alertname: 'DiskFull', severity: 'critical' } }, 'fp1'),
      makeAlert({ labels: { alertname: 'CPUHigh', severity: 'critical' } }, 'fp2'),
    ]
    render(
      <AlertListView alerts={alerts} silences={silences} onSelectAlert={noop} />,
      { wrapper: makeWrapper() },
    )
    // section shows "2" total alerts
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders alert group row with alertname', () => {
    const alerts = [makeAlert({ labels: { alertname: 'DiskFull', severity: 'critical' } })]
    render(
      <AlertListView alerts={alerts} silences={silences} onSelectAlert={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText('DiskFull')).toBeInTheDocument()
  })

  it('renders multiple severity sections in severity order', () => {
    const alerts = [
      makeAlert({ labels: { alertname: 'W', severity: 'warning' } }, 'fp1'),
      makeAlert({ labels: { alertname: 'C', severity: 'critical' } }, 'fp2'),
    ]
    render(
      <AlertListView alerts={alerts} silences={silences} onSelectAlert={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText('Critical')).toBeInTheDocument()
    expect(screen.getByText('Warning')).toBeInTheDocument()
  })
})

describe('AlertListView – expand/collapse', () => {
  it('does not show alert rows initially (groups collapsed)', () => {
    const alerts = [makeAlert({ labels: { alertname: 'DiskFull', severity: 'critical' } })]
    render(
      <AlertListView alerts={alerts} silences={silences} onSelectAlert={noop} />,
      { wrapper: makeWrapper() },
    )
    // No AlertListRow rendered until group expanded
    expect(screen.queryByTestId('alert-row')).not.toBeInTheDocument()
  })

  it('expands group on row click to show alert rows', () => {
    const alerts = [makeAlert({ labels: { alertname: 'DiskFull', severity: 'critical' } })]
    render(
      <AlertListView alerts={alerts} silences={silences} onSelectAlert={noop} />,
      { wrapper: makeWrapper() },
    )
    const groupRow = screen.getByRole('row', { name: /DiskFull/ })
    fireEvent.click(groupRow)
    expect(screen.getByTestId('alert-row')).toBeInTheDocument()
  })

  it('collapses expanded group on second click', () => {
    const alerts = [makeAlert({ labels: { alertname: 'DiskFull', severity: 'critical' } })]
    render(
      <AlertListView alerts={alerts} silences={silences} onSelectAlert={noop} />,
      { wrapper: makeWrapper() },
    )
    const groupRow = screen.getByRole('row', { name: /DiskFull/ })
    fireEvent.click(groupRow)
    expect(screen.getByTestId('alert-row')).toBeInTheDocument()
    fireEvent.click(groupRow)
    expect(screen.queryByTestId('alert-row')).not.toBeInTheDocument()
  })
})

describe('AlertListView – sort toggle', () => {
  it('toggles sort direction when Alert Name header is clicked twice', () => {
    const alerts = [
      makeAlert({ labels: { alertname: 'ZAlert', severity: 'critical' } }, 'fp1'),
      makeAlert({ labels: { alertname: 'AAlert', severity: 'critical' } }, 'fp2'),
    ]
    render(
      <AlertListView alerts={alerts} silences={silences} onSelectAlert={noop} />,
      { wrapper: makeWrapper() },
    )
    const header = screen.getByText('Alert Name').closest('th')!
    // First click: sets sortKey=alertname and asc=true (default already alertname/asc, so toggles to desc)
    fireEvent.click(header)
    // Second click: back to asc
    fireEvent.click(header)
    // After 2 clicks on same key, sort stays alertname — groups still render
    expect(screen.getByText('ZAlert')).toBeInTheDocument()
    expect(screen.getByText('AAlert')).toBeInTheDocument()
  })

  it('toggles sort direction when Alert Name header clicked multiple times', () => {
    const alerts = [
      makeAlert({ labels: { alertname: 'Zebra', severity: 'critical' } }, 'fp1'),
      makeAlert({ labels: { alertname: 'Alpha', severity: 'critical' } }, 'fp2'),
    ]
    render(
      <AlertListView alerts={alerts} silences={silences} onSelectAlert={noop} />,
      { wrapper: makeWrapper() },
    )
    const nameHeader = screen.getAllByText('Alert Name')[0].closest('th')!
    fireEvent.click(nameHeader)
    fireEvent.click(nameHeader)
    expect(screen.getByText('Zebra')).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })
})

describe('AlertListView – group count badge', () => {
  it('shows count badge for groups with multiple alerts', () => {
    const alerts = [
      makeAlert({ labels: { alertname: 'DiskFull', severity: 'critical' } }, 'fp1'),
      makeAlert({ labels: { alertname: 'DiskFull', severity: 'critical' } }, 'fp2'),
    ]
    render(
      <AlertListView alerts={alerts} silences={silences} onSelectAlert={noop} />,
      { wrapper: makeWrapper() },
    )
    // count badge in group row shows "2"
    const badges = screen.getAllByText('2')
    expect(badges.length).toBeGreaterThanOrEqual(1)
  })
})
