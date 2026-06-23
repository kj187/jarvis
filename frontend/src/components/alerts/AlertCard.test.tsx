import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { AlertCard } from './AlertCard'
import { useUIStore } from '@/store/uiStore'
import type { EnrichedAlert, Silence } from '@/types'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/api/client', () => ({
  fetchClusters: vi.fn().mockResolvedValue([
    { name: 'homelab', alertmanagerUrl: 'http://am:9093', prometheusUrl: '', healthy: true, alertCount: 1 },
  ]),
}))

vi.mock('@/hooks/useAlerts', () => ({
  useAlertStats: vi.fn().mockReturnValue({ data: null }),
}))

vi.mock('@/components/silences/SilenceForm', () => ({
  SilenceForm: () => <div data-testid="silence-form">SilenceForm</div>,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

function makeAlert(overrides: Partial<EnrichedAlert> = {}, fp = 'fp1'): EnrichedAlert {
  return {
    fingerprint: fp,
    status: { state: 'active', inhibitedBy: [], silencedBy: [] },
    labels: { alertname: 'DiskFull', severity: 'critical' },
    annotations: {},
    startsAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    endsAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    generatorURL: '',
    receivers: [{ name: 'email' }],
    clusterName: 'homelab',
    alertmanagerUrl: 'http://am:9093',
    ...overrides,
  }
}

const noop = () => {}
const silences: Silence[] = []

beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState({ filters: { state: '', search: '', labelMatchers: [] } })
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AlertCard – rendering', () => {
  it('renders alert name in card header', () => {
    render(
      <AlertCard alerts={[makeAlert()]} silences={silences} onClick={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText('DiskFull')).toBeInTheDocument()
  })

  it('renders severity badge', () => {
    render(
      <AlertCard alerts={[makeAlert()]} silences={silences} onClick={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText('Critical')).toBeInTheDocument()
  })

  it('renders single alert entry without count badge', () => {
    render(
      <AlertCard alerts={[makeAlert()]} silences={silences} onClick={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.queryByText(/×\d/)).not.toBeInTheDocument()
  })

  it('renders count badge when multiple alerts in group', () => {
    const alerts = [makeAlert({}, 'fp1'), makeAlert({}, 'fp2')]
    render(
      <AlertCard alerts={alerts} silences={silences} onClick={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText('×2')).toBeInTheDocument()
  })

  it('renders annotation summary when present', () => {
    const alert = makeAlert({ annotations: { summary: 'Disk is nearly full' } })
    render(
      <AlertCard alerts={[alert]} silences={silences} onClick={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText('Disk is nearly full')).toBeInTheDocument()
  })

  it('renders warning severity badge for warning alerts', () => {
    const alert = makeAlert({ labels: { alertname: 'HighCPU', severity: 'warning' } })
    render(
      <AlertCard alerts={[alert]} silences={silences} onClick={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText('Warning')).toBeInTheDocument()
  })
})

describe('AlertCard – interaction', () => {
  it('calls onClick with fingerprint when alert entry clicked', () => {
    const onClick = vi.fn()
    render(
      <AlertCard alerts={[makeAlert()]} silences={silences} onClick={onClick} />,
      { wrapper: makeWrapper() },
    )
    // AlertEntry is a div[role="button"] without a title; Bell button has title="Create silence"
    const entryButton = screen.getAllByRole('button').find((b) => !b.getAttribute('title'))!
    fireEvent.click(entryButton)
    expect(onClick).toHaveBeenCalledWith('fp1')
  })

  it('shows create silence button', () => {
    render(
      <AlertCard alerts={[makeAlert()]} silences={silences} onClick={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByTitle('Create silence')).toBeInTheDocument()
  })

  it('invokes onCreateSilence when create silence button clicked', () => {
    const onCreateSilence = vi.fn()
    const alert = makeAlert()
    render(
      <AlertCard alerts={[alert]} silences={silences} onClick={noop} onCreateSilence={onCreateSilence} />,
      { wrapper: makeWrapper() },
    )
    fireEvent.click(screen.getByTitle('Create silence'))
    expect(onCreateSilence).toHaveBeenCalledWith([alert])
  })
})

describe('AlertCard – pagination', () => {
  it('does not show pagination when ≤3 alerts', () => {
    const alerts = [makeAlert({}, 'fp1'), makeAlert({}, 'fp2'), makeAlert({}, 'fp3')]
    render(
      <AlertCard alerts={alerts} silences={silences} onClick={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.queryByText(/of 3/)).not.toBeInTheDocument()
  })

  it('shows pagination when >3 alerts', () => {
    const alerts = Array.from({ length: 4 }, (_, i) => makeAlert({}, `fp${i}`))
    render(
      <AlertCard alerts={alerts} silences={silences} onClick={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText('1–3 of 4')).toBeInTheDocument()
  })

  it('navigates to next page when + clicked', () => {
    const alerts = Array.from({ length: 4 }, (_, i) =>
      makeAlert({ labels: { alertname: `Alert${i}`, severity: 'critical' } }, `fp${i}`),
    )
    render(
      <AlertCard alerts={alerts} silences={silences} onClick={noop} />,
      { wrapper: makeWrapper() },
    )
    fireEvent.click(screen.getByText('+'))
    expect(screen.getByText('4–4 of 4')).toBeInTheDocument()
  })
})

describe('AlertCard – claim banner', () => {
  it('renders claim banner when alert has activeClaim', () => {
    const alert = makeAlert({
      activeClaim: {
        id: 1,
        fingerprint: 'fp1',
        claimedBy: 'alice',
        claimedAt: new Date(Date.now() - 60_000).toISOString(),
        note: 'working on it',
      },
    })
    render(
      <AlertCard alerts={[alert]} silences={silences} onClick={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText(/In progress: alice/)).toBeInTheDocument()
    expect(screen.getByText('working on it')).toBeInTheDocument()
  })
})

describe('AlertCard – silence banner', () => {
  it('renders active silence banner when alert is silenced', () => {
    const now = Date.now()
    const silence: Silence = {
      id: 's1',
      matchers: [],
      startsAt: new Date(now - 5 * 60_000).toISOString(),
      endsAt: new Date(now + 60 * 60_000).toISOString(),
      createdBy: 'alice',
      comment: 'test',
      status: { state: 'active' },
      updatedAt: new Date().toISOString(),
      clusterName: 'homelab',
      alertmanagerUrl: '',
    }
    const alert = makeAlert({
      status: { state: 'suppressed', inhibitedBy: [], silencedBy: ['s1'] },
    })
    render(
      <AlertCard alerts={[alert]} silences={[silence]} onClick={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText('SILENCE ACTIVE')).toBeInTheDocument()
  })
})
