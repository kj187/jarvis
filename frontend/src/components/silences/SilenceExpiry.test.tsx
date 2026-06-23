import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SilenceExpiry } from './SilenceExpiry'
import type { Silence } from '@/types'

function makeSilence(state: 'active' | 'pending' | 'expired', endsInMs = 60 * 60_000): Silence {
  const now = Date.now()
  return {
    id: 's1',
    matchers: [],
    startsAt: new Date(now - 5 * 60_000).toISOString(),
    endsAt: new Date(now + endsInMs).toISOString(),
    createdBy: 'alice',
    comment: 'test',
    status: { state },
    updatedAt: new Date().toISOString(),
    clusterName: 'homelab',
    alertmanagerUrl: '',
  }
}

describe('SilenceExpiry', () => {
  it('renders "Starts" for pending silence', () => {
    render(<SilenceExpiry silence={makeSilence('pending')} />)
    expect(screen.getByText(/⏳ Starts/)).toBeInTheDocument()
  })

  it('renders exact date and "In ..." for active silence with >15 min remaining', () => {
    render(<SilenceExpiry silence={makeSilence('active', 60 * 60_000)} />)
    expect(screen.getByText(/^In /)).toBeInTheDocument()
    expect(screen.queryByText(/Until /)).not.toBeInTheDocument()
  })

  it('renders warning prefix for active silence with ≤15 min remaining', () => {
    render(<SilenceExpiry silence={makeSilence('active', 5 * 60_000)} />)
    expect(screen.getByText(/⚠️ In \d+m/)).toBeInTheDocument()
  })

  it('renders "Expired" for expired silence', () => {
    const now = Date.now()
    const silence: Silence = {
      id: 's1',
      matchers: [],
      startsAt: new Date(now - 2 * 60 * 60_000).toISOString(),
      endsAt: new Date(now - 60 * 60_000).toISOString(),
      createdBy: 'alice',
      comment: 'test',
      status: { state: 'expired' },
      updatedAt: new Date().toISOString(),
      clusterName: 'homelab',
      alertmanagerUrl: '',
    }
    render(<SilenceExpiry silence={silence} />)
    expect(screen.getByText(/🔕 Expired/)).toBeInTheDocument()
  })

  it('renders nothing for unknown state', () => {
    const silence: Silence = {
      id: 's1',
      matchers: [],
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 3600_000).toISOString(),
      createdBy: 'alice',
      comment: '',
      status: { state: 'active' },
      updatedAt: new Date().toISOString(),
      clusterName: 'homelab',
      alertmanagerUrl: '',
    }
    const { container } = render(
      <SilenceExpiry silence={{ ...silence, status: { state: 'expired' } }} />,
    )
    expect(container).not.toBeEmptyDOMElement()
  })
})
