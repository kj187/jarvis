import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SilenceCard } from './SilenceCard'
import type { Silence, EnrichedAlert } from '@/types'

function makeSilence(state: 'active' | 'pending' | 'expired' = 'active'): Silence {
  const now = Date.now()
  return {
    id: 's1',
    matchers: [
      { isEqual: true, isRegex: false, name: 'alertname', value: 'DiskFull' },
    ],
    startsAt: new Date(now - 5 * 60_000).toISOString(),
    endsAt: new Date(now + 60 * 60_000).toISOString(),
    createdBy: 'alice',
    comment: 'disk is full',
    status: { state },
    updatedAt: new Date().toISOString(),
    clusterName: 'homelab',
    alertmanagerUrl: 'http://am:9093',
  }
}

function makeAlert(silencedBy: string[] = []): EnrichedAlert {
  return {
    fingerprint: 'fp1',
    status: { state: 'suppressed', inhibitedBy: [], silencedBy },
    labels: { alertname: 'DiskFull', severity: 'critical' },
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SilenceCard – rendering', () => {
  it('renders cluster name', () => {
    render(<SilenceCard silence={makeSilence()} alerts={[]} onEdit={noop} onExpire={noop} />)
    expect(screen.getByText('homelab')).toBeInTheDocument()
  })

  it('renders silence state badge', () => {
    render(<SilenceCard silence={makeSilence('active')} alerts={[]} onEdit={noop} onExpire={noop} />)
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('renders pending state badge', () => {
    render(<SilenceCard silence={makeSilence('pending')} alerts={[]} onEdit={noop} onExpire={noop} />)
    expect(screen.getByText('pending')).toBeInTheDocument()
  })

  it('renders expired state badge', () => {
    const expired: Silence = {
      ...makeSilence('expired'),
      endsAt: new Date(Date.now() - 3600_000).toISOString(),
    }
    render(<SilenceCard silence={expired} alerts={[]} onEdit={noop} onExpire={noop} />)
    expect(screen.getByText('expired')).toBeInTheDocument()
  })

  it('renders matcher chips', () => {
    render(<SilenceCard silence={makeSilence()} alerts={[]} onEdit={noop} onExpire={noop} />)
    expect(screen.getByText('alertname=DiskFull')).toBeInTheDocument()
  })

  it('renders comment text', () => {
    render(<SilenceCard silence={makeSilence()} alerts={[]} onEdit={noop} onExpire={noop} />)
    expect(screen.getByText('disk is full')).toBeInTheDocument()
  })

  it('renders creator name', () => {
    render(<SilenceCard silence={makeSilence()} alerts={[]} onEdit={noop} onExpire={noop} />)
    expect(screen.getByText('by alice')).toBeInTheDocument()
  })

  it('shows affected alert count', () => {
    const alert = makeAlert(['s1'])
    render(<SilenceCard silence={makeSilence()} alerts={[alert]} onEdit={noop} onExpire={noop} />)
    expect(screen.getByText('Affected: 1')).toBeInTheDocument()
  })

  it('shows 0 affected when no alerts match', () => {
    render(<SilenceCard silence={makeSilence()} alerts={[makeAlert([])] } onEdit={noop} onExpire={noop} />)
    expect(screen.getByText('Affected: 0')).toBeInTheDocument()
  })
})

describe('SilenceCard – actions', () => {
  it('calls onEdit when an active silence card is clicked', async () => {
    const onEdit = vi.fn()
    const silence = makeSilence('active')
    render(<SilenceCard silence={silence} alerts={[]} onEdit={onEdit} onExpire={noop} />)
    await userEvent.click(screen.getByText('disk is full'))
    expect(onEdit).toHaveBeenCalledWith(silence)
  })

  it('calls onEdit (re-create) when an expired silence card is clicked', async () => {
    const onEdit = vi.fn()
    const expired: Silence = {
      ...makeSilence('expired'),
      endsAt: new Date(Date.now() - 3600_000).toISOString(),
    }
    render(<SilenceCard silence={expired} alerts={[]} onEdit={onEdit} onExpire={noop} />)
    await userEvent.click(screen.getByText('disk is full'))
    expect(onEdit).toHaveBeenCalledWith(expired)
  })

  it('shows a re-create button (not expire) for expired silence', async () => {
    const onEdit = vi.fn()
    const onExpire = vi.fn()
    const expired: Silence = {
      ...makeSilence('expired'),
      endsAt: new Date(Date.now() - 3600_000).toISOString(),
    }
    render(<SilenceCard silence={expired} alerts={[]} onEdit={onEdit} onExpire={onExpire} />)
    const btn = screen.getByTitle('Re-create silence')
    await userEvent.click(btn)
    expect(onEdit).toHaveBeenCalledWith(expired)
    expect(onExpire).not.toHaveBeenCalled()
  })

  it('calls onExpire directly when expire button clicked', async () => {
    const onExpire = vi.fn()
    const silence = makeSilence()
    render(<SilenceCard silence={silence} alerts={[]} onEdit={noop} onExpire={onExpire} />)
    const buttons = screen.getAllByRole('button')
    await userEvent.click(buttons.at(-1)!)
    expect(onExpire).toHaveBeenCalledWith(silence)
  })
})
