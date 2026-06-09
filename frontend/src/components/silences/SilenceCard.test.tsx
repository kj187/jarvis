import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
    render(<SilenceCard silence={makeSilence()} alerts={[]} onEdit={noop} onDelete={noop} />)
    expect(screen.getByText('homelab')).toBeInTheDocument()
  })

  it('renders silence state badge', () => {
    render(<SilenceCard silence={makeSilence('active')} alerts={[]} onEdit={noop} onDelete={noop} />)
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('renders pending state badge', () => {
    render(<SilenceCard silence={makeSilence('pending')} alerts={[]} onEdit={noop} onDelete={noop} />)
    expect(screen.getByText('pending')).toBeInTheDocument()
  })

  it('renders expired state badge', () => {
    const expired: Silence = {
      ...makeSilence('expired'),
      endsAt: new Date(Date.now() - 3600_000).toISOString(),
    }
    render(<SilenceCard silence={expired} alerts={[]} onEdit={noop} onDelete={noop} />)
    expect(screen.getByText('expired')).toBeInTheDocument()
  })

  it('renders matcher chips', () => {
    render(<SilenceCard silence={makeSilence()} alerts={[]} onEdit={noop} onDelete={noop} />)
    expect(screen.getByText('alertname=DiskFull')).toBeInTheDocument()
  })

  it('renders comment text', () => {
    render(<SilenceCard silence={makeSilence()} alerts={[]} onEdit={noop} onDelete={noop} />)
    expect(screen.getByText('disk is full')).toBeInTheDocument()
  })

  it('renders creator name', () => {
    render(<SilenceCard silence={makeSilence()} alerts={[]} onEdit={noop} onDelete={noop} />)
    expect(screen.getByText('by alice')).toBeInTheDocument()
  })

  it('shows affected alert count', () => {
    const alert = makeAlert(['s1'])
    render(<SilenceCard silence={makeSilence()} alerts={[alert]} onEdit={noop} onDelete={noop} />)
    expect(screen.getByText('Affected: 1')).toBeInTheDocument()
  })

  it('shows 0 affected when no alerts match', () => {
    render(<SilenceCard silence={makeSilence()} alerts={[makeAlert([])] } onEdit={noop} onDelete={noop} />)
    expect(screen.getByText('Affected: 0')).toBeInTheDocument()
  })
})

describe('SilenceCard – actions', () => {
  it('calls onEdit when edit button (first icon button) clicked for active silence', async () => {
    const onEdit = vi.fn()
    render(<SilenceCard silence={makeSilence('active')} alerts={[]} onEdit={onEdit} onDelete={noop} />)
    // For active silence: buttons are [Edit, Trash]. Edit is first.
    const buttons = screen.getAllByRole('button')
    await userEvent.click(buttons[0])
    expect(onEdit).toHaveBeenCalledOnce()
  })

  it('shows edit button for active silence', () => {
    render(<SilenceCard silence={makeSilence('active')} alerts={[]} onEdit={noop} onDelete={noop} />)
    // 2 buttons: edit + trash
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(2)
  })

  it('does not show edit button for expired silence', () => {
    const expired: Silence = {
      ...makeSilence('expired'),
      endsAt: new Date(Date.now() - 3600_000).toISOString(),
    }
    render(<SilenceCard silence={expired} alerts={[]} onEdit={noop} onDelete={noop} />)
    // Only trash button (no edit)
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('shows confirm delete buttons when trash is clicked', async () => {
    render(<SilenceCard silence={makeSilence()} alerts={[]} onEdit={noop} onDelete={noop} />)
    const trashButton = screen.getAllByRole('button').at(-1)!
    await userEvent.click(trashButton)
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument()
  })

  it('cancels delete when No is clicked', async () => {
    render(<SilenceCard silence={makeSilence()} alerts={[]} onEdit={noop} onDelete={noop} />)
    await userEvent.click(screen.getAllByRole('button').at(-1)!)
    await userEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('calls onDelete when Delete confirmed', async () => {
    const onDelete = vi.fn()
    const silence = makeSilence()
    render(<SilenceCard silence={silence} alerts={[]} onEdit={noop} onDelete={onDelete} />)
    await userEvent.click(screen.getAllByRole('button').at(-1)!)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledWith(silence)
  })
})
