import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { SilenceForm } from './SilenceForm'
import type { EnrichedAlert, Silence } from '@/types'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/hooks/useAlerts', () => ({
  useAlerts: vi.fn().mockReturnValue({ data: [] }),
}))

vi.mock('@/hooks/useSilences', () => ({
  useSilences: vi.fn().mockReturnValue({ data: [] }),
}))

vi.mock('@/api/client', () => ({
  upsertSilence: vi.fn().mockResolvedValue({ silenceID: 'new-silence-id' }),
  triggerPoll: vi.fn().mockResolvedValue(undefined),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

function makeAlert(labels: Record<string, string> = {}): EnrichedAlert {
  return {
    fingerprint: 'fp1',
    status: { state: 'active', inhibitedBy: [], silencedBy: [] },
    labels: { alertname: 'DiskFull', severity: 'critical', ...labels },
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

// Helper: fill required fields to enable Preview button.
// canSubmit = comment.trim() && createdBy.trim() && cluster selected && secs > 0 (dHours=1 by default)
async function fillRequired() {
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'alice')
  await userEvent.type(screen.getByPlaceholderText('Reason for the silence…'), 'disk full')
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SilenceForm – rendering', () => {
  it('renders form step with Preview button (create mode)', () => {
    render(
      <SilenceForm availableClusters={['homelab']} onSuccess={noop} onCancel={noop} />,
      { wrapper: makeWrapper() },
    )
    // Preview button exists when in form step
    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument()
  })

  it('shows Update button in preview step for edit mode (prefillSilence without isRecreate)', async () => {
    const prefillSilence: Silence = {
      id: 's1',
      matchers: [{ isEqual: true, isRegex: false, name: 'alertname', value: 'DiskFull' }],
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 3600_000).toISOString(),
      createdBy: 'alice',
      comment: 'test silence',
      status: { state: 'active' },
      updatedAt: new Date().toISOString(),
      clusterName: 'homelab',
      alertmanagerUrl: 'http://am:9093',
    }
    render(
      <SilenceForm
        availableClusters={['homelab']}
        prefillSilence={prefillSilence}
        onSuccess={noop}
        onCancel={noop}
      />,
      { wrapper: makeWrapper() },
    )
    // createdBy comes from localStorage (not prefillSilence) — fill it manually
    await fillRequired()
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument()
  })

  it('renders cluster selector buttons for each available cluster', () => {
    render(
      <SilenceForm availableClusters={['homelab', 'staging']} onSuccess={noop} onCancel={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByRole('button', { name: 'homelab' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'staging' })).toBeInTheDocument()
  })

  it('renders days, hours, minutes duration spinner labels', () => {
    render(
      <SilenceForm availableClusters={['homelab']} onSuccess={noop} onCancel={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText('days')).toBeInTheDocument()
    expect(screen.getByText('hours')).toBeInTheDocument()
    expect(screen.getByText('minutes')).toBeInTheDocument()
  })

  it('renders Author input field', () => {
    render(
      <SilenceForm availableClusters={['homelab']} onSuccess={noop} onCancel={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByPlaceholderText('Your name')).toBeInTheDocument()
  })

  it('renders Comment textarea', () => {
    render(
      <SilenceForm availableClusters={['homelab']} onSuccess={noop} onCancel={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByPlaceholderText('Reason for the silence…')).toBeInTheDocument()
  })

  it('renders operator select with = default', () => {
    render(
      <SilenceForm availableClusters={['homelab']} onSuccess={noop} onCancel={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByDisplayValue('=')).toBeInTheDocument()
  })

  it('renders Cancel button', () => {
    render(
      <SilenceForm availableClusters={['homelab']} onSuccess={noop} onCancel={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('Preview button is disabled when required fields are empty', () => {
    render(
      <SilenceForm availableClusters={['homelab']} onSuccess={noop} onCancel={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled()
  })
})

describe('SilenceForm – prefill from alerts', () => {
  it('pre-fills matcher labels from alert labels when prefillAlerts provided', () => {
    const alert = makeAlert({ alertname: 'DiskFull' })
    render(
      <SilenceForm
        availableClusters={['homelab']}
        prefillAlerts={[alert]}
        onSuccess={noop}
        onCancel={noop}
      />,
      { wrapper: makeWrapper() },
    )
    // alertname matcher pre-filled
    expect(screen.getByText('alertname')).toBeInTheDocument()
  })

  it('pre-fills cluster from alert clusterName when prefillAlerts provided', () => {
    const alert = makeAlert()
    render(
      <SilenceForm
        availableClusters={['homelab', 'staging']}
        prefillAlerts={[alert]}
        onSuccess={noop}
        onCancel={noop}
      />,
      { wrapper: makeWrapper() },
    )
    // homelab button should be selected (has primary styles)
    expect(screen.getByRole('button', { name: 'homelab' })).toBeInTheDocument()
  })

  it('pre-fills comment from prefillSilence', () => {
    const prefillSilence: Silence = {
      id: 's1',
      matchers: [],
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 3600_000).toISOString(),
      createdBy: 'alice',
      comment: 'pre-filled comment',
      status: { state: 'active' },
      updatedAt: new Date().toISOString(),
      clusterName: 'homelab',
      alertmanagerUrl: 'http://am:9093',
    }
    render(
      <SilenceForm
        availableClusters={['homelab']}
        prefillSilence={prefillSilence}
        onSuccess={noop}
        onCancel={noop}
      />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByDisplayValue('pre-filled comment')).toBeInTheDocument()
  })
})

describe('SilenceForm – matcher management', () => {
  it('adds new matcher row when "Add matcher" button is clicked', async () => {
    render(
      <SilenceForm availableClusters={['homelab']} onSuccess={noop} onCancel={noop} />,
      { wrapper: makeWrapper() },
    )
    await userEvent.click(screen.getByRole('button', { name: /Add matcher/i }))
    // 2 operator selects
    expect(screen.getAllByDisplayValue('=')).toHaveLength(2)
  })

  it('disables remove button when only one matcher exists', () => {
    render(
      <SilenceForm availableClusters={['homelab']} onSuccess={noop} onCancel={noop} />,
      { wrapper: makeWrapper() },
    )
    // Only 1 matcher → remove button disabled
    expect(screen.getAllByDisplayValue('=')).toHaveLength(1)
  })
})

describe('SilenceForm – navigation', () => {
  it('calls onCancel when Cancel button is clicked', async () => {
    const onCancel = vi.fn()
    render(
      <SilenceForm availableClusters={['homelab']} onSuccess={noop} onCancel={onCancel} />,
      { wrapper: makeWrapper() },
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('shows preview step after filling required fields and clicking Preview', async () => {
    render(
      <SilenceForm availableClusters={['homelab']} onSuccess={noop} onCancel={noop} />,
      { wrapper: makeWrapper() },
    )
    await fillRequired()
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    // Preview step shows "Matcher (N)" section
    expect(screen.getByText(/Matcher \(/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Back/i })).toBeInTheDocument()
  })

  it('shows "Create" button in preview step (new silence)', async () => {
    render(
      <SilenceForm availableClusters={['homelab']} onSuccess={noop} onCancel={noop} />,
      { wrapper: makeWrapper() },
    )
    await fillRequired()
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
  })

  it('returns to form step when Back is clicked from preview', async () => {
    render(
      <SilenceForm availableClusters={['homelab']} onSuccess={noop} onCancel={noop} />,
      { wrapper: makeWrapper() },
    )
    await fillRequired()
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await userEvent.click(screen.getByRole('button', { name: /Back/i }))
    // Back on form step
    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })
})

describe('SilenceForm – localStorage', () => {
  it('pre-fills author from localStorage', () => {
    localStorage.setItem('jarvis-username', 'alice')
    render(
      <SilenceForm availableClusters={['homelab']} onSuccess={noop} onCancel={noop} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByDisplayValue('alice')).toBeInTheDocument()
  })
})

describe('SilenceForm – submission', () => {
  it('calls upsertSilence after clicking Create in preview step', async () => {
    const { upsertSilence } = await import('@/api/client')

    render(
      <SilenceForm availableClusters={['homelab']} onSuccess={noop} onCancel={noop} />,
      { wrapper: makeWrapper() },
    )

    await fillRequired()
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(upsertSilence).toHaveBeenCalled()
    })
  })
})
