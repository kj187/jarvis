import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { AlertCardGrid } from './AlertCardGrid'
import type { EnrichedAlert, Silence } from '@/types'

vi.mock('./AlertCard', () => ({
  AlertCard: ({ alerts }: { alerts: EnrichedAlert[] }) => (
    <div data-testid="alert-card">{alerts.map((a) => a.labels['alertname']).join(',')}</div>
  ),
}))

function renderGrid(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(createElement(QueryClientProvider, { client: qc }, ui))
}

function makeAlert(labels: Record<string, string> = {}, fp = 'fp1'): EnrichedAlert {
  return {
    fingerprint: fp,
    status: { state: 'active', inhibitedBy: [], silencedBy: [] },
    labels: { alertname: 'TestAlert', severity: 'critical', ...labels },
    annotations: {},
    startsAt: new Date().toISOString(),
    endsAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    generatorURL: '',
    receivers: [{ name: 'email' }],
    clusterName: 'homelab',
    alertmanagerUrl: 'http://am:9093',
  }
}

const noop = () => {}
const silences: Silence[] = []

describe('AlertCardGrid – empty state', () => {
  it('renders empty state when alerts array is empty', () => {
    renderGrid(<AlertCardGrid alerts={[]} silences={silences} onSelectAlert={noop} />)
    expect(screen.getByLabelText('No alerts')).toBeInTheDocument()
  })

  it('does not render severity sections when empty', () => {
    renderGrid(<AlertCardGrid alerts={[]} silences={silences} onSelectAlert={noop} />)
    expect(screen.queryByText(/Critical/i)).not.toBeInTheDocument()
  })
})

describe('AlertCardGrid – severity sections', () => {
  it('renders Critical section for critical alerts', () => {
    const alerts = [makeAlert({ alertname: 'DiskFull', severity: 'critical' })]
    renderGrid(<AlertCardGrid alerts={alerts} silences={silences} onSelectAlert={noop} />)
    expect(screen.getByText(/Critical/i)).toBeInTheDocument()
  })

  it('renders Warning section for warning alerts', () => {
    const alerts = [makeAlert({ alertname: 'HighCPU', severity: 'warning' })]
    renderGrid(<AlertCardGrid alerts={alerts} silences={silences} onSelectAlert={noop} />)
    expect(screen.getByText(/Warning/i)).toBeInTheDocument()
  })

  it('renders Info section for info alerts', () => {
    const alerts = [makeAlert({ alertname: 'DiskFull', severity: 'info' })]
    renderGrid(<AlertCardGrid alerts={alerts} silences={silences} onSelectAlert={noop} />)
    expect(screen.getByRole('heading', { level: 2, name: /Info/i })).toBeInTheDocument()
  })

  it('renders multiple severity sections in order', () => {
    const alerts = [
      makeAlert({ alertname: 'CritAlert', severity: 'critical' }, 'fp1'),
      makeAlert({ alertname: 'WarnAlert', severity: 'warning' }, 'fp2'),
    ]
    renderGrid(<AlertCardGrid alerts={alerts} silences={silences} onSelectAlert={noop} />)
    const sections = screen.getAllByRole('heading', { level: 2 })
    expect(sections[0].textContent).toMatch(/Critical/i)
    expect(sections[1].textContent).toMatch(/Warning/i)
  })

  it('shows alert count in severity section header', () => {
    const alerts = [
      makeAlert({ alertname: 'A', severity: 'critical' }, 'fp1'),
      makeAlert({ alertname: 'B', severity: 'critical' }, 'fp2'),
    ]
    renderGrid(<AlertCardGrid alerts={alerts} silences={silences} onSelectAlert={noop} />)
    // 2 alerts → count shown in heading
    expect(screen.getByText(/\(2\)/)).toBeInTheDocument()
  })
})

describe('AlertCardGrid – grouping', () => {
  it('groups alerts by alertname within severity', () => {
    const alerts = [
      makeAlert({ alertname: 'DiskFull', severity: 'critical' }, 'fp1'),
      makeAlert({ alertname: 'DiskFull', severity: 'critical' }, 'fp2'),
    ]
    renderGrid(<AlertCardGrid alerts={alerts} silences={silences} onSelectAlert={noop} />)
    // Both alerts merged into one card
    const cards = screen.getAllByTestId('alert-card')
    expect(cards).toHaveLength(1)
    expect(cards[0].textContent).toContain('DiskFull')
  })

  it('renders separate cards for different alertnames', () => {
    const alerts = [
      makeAlert({ alertname: 'DiskFull', severity: 'critical' }, 'fp1'),
      makeAlert({ alertname: 'CPUHigh', severity: 'critical' }, 'fp2'),
    ]
    renderGrid(<AlertCardGrid alerts={alerts} silences={silences} onSelectAlert={noop} />)
    expect(screen.getAllByTestId('alert-card')).toHaveLength(2)
  })

  it('renders separate cards for same name but different severity', () => {
    const alerts = [
      makeAlert({ alertname: 'DiskFull', severity: 'critical' }, 'fp1'),
      makeAlert({ alertname: 'DiskFull', severity: 'warning' }, 'fp2'),
    ]
    renderGrid(<AlertCardGrid alerts={alerts} silences={silences} onSelectAlert={noop} />)
    expect(screen.getAllByTestId('alert-card')).toHaveLength(2)
  })
})
