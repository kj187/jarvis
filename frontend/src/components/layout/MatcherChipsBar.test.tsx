import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MatcherChipsBar } from './MatcherChipsBar'
import { useUIStore } from '@/store/uiStore'

vi.mock('@/hooks/useAlerts', () => ({
  useAlerts: vi.fn().mockReturnValue({
    data: [
      { labels: { fstype: 'ext4', job: 'node-exporter' } },
      { labels: { fstype: 'xfs', job: 'node-exporter' } },
    ],
  }),
}))

beforeEach(() => {
  useUIStore.setState({
    filters: { state: 'active', search: '', labelMatchers: [] },
  })
})

function setExisting() {
  useUIStore.setState({
    filters: {
      state: 'active',
      search: '',
      labelMatchers: [{ id: 'm1', name: 'fstype', operator: '=', value: 'ext4' }],
    },
  })
}

describe('MatcherChipsBar', () => {
  it('renders nothing without matchers when allowAdd is false', () => {
    const { container } = render(<MatcherChipsBar />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows an add button when allowAdd is set', () => {
    render(<MatcherChipsBar allowAdd />)
    expect(screen.getByLabelText('Add filter')).toBeInTheDocument()
  })

  it('adds a matcher: label Enter then value Enter promotes the draft', async () => {
    render(<MatcherChipsBar allowAdd />)
    await userEvent.click(screen.getByLabelText('Add filter'))
    await userEvent.type(screen.getByLabelText('Label name'), 'fstype{enter}')
    await userEvent.type(screen.getByLabelText('Label value'), 'ext4{enter}')
    expect(useUIStore.getState().filters.labelMatchers).toMatchObject([
      { name: 'fstype', operator: '=', value: 'ext4' },
    ])
  })

  it('does not promote a draft with only a value', async () => {
    render(<MatcherChipsBar allowAdd />)
    await userEvent.click(screen.getByLabelText('Add filter'))
    await userEvent.type(screen.getByLabelText('Label value'), 'ext4{enter}')
    expect(useUIStore.getState().filters.labelMatchers).toHaveLength(0)
  })

  it('supports multiple value chips joined with | when operator is regex', async () => {
    useUIStore.setState({
      filters: {
        state: 'active',
        search: '',
        labelMatchers: [{ id: 'm1', name: 'fstype', operator: '=~', value: 'ext4' }],
      },
    })
    render(<MatcherChipsBar />)
    await userEvent.type(screen.getByLabelText('Label value'), 'xfs{enter}')
    expect(useUIStore.getState().filters.labelMatchers[0].value).toBe('ext4|xfs')
  })

  it('removes a single value chip with its X without removing the filter', async () => {
    setExisting()
    render(<MatcherChipsBar />)
    await userEvent.click(screen.getByLabelText('Remove Label value ext4'))
    const m = useUIStore.getState().filters.labelMatchers[0]
    expect(m).toMatchObject({ id: 'm1', value: '' })
  })

  it('removes the whole filter via the filter X', async () => {
    setExisting()
    render(<MatcherChipsBar />)
    await userEvent.click(screen.getByLabelText('Remove filter fstype=ext4'))
    expect(useUIStore.getState().filters.labelMatchers).toHaveLength(0)
  })

  it('hides value input (no autocomplete) for = once a value is set', () => {
    setExisting() // operator '='
    render(<MatcherChipsBar />)
    expect(screen.queryByLabelText('Label value')).not.toBeInTheDocument()
  })

  it('allows multiple values once operator is regex', async () => {
    useUIStore.setState({
      filters: {
        state: 'active',
        search: '',
        labelMatchers: [{ id: 'm1', name: 'fstype', operator: '=~', value: 'ext4' }],
      },
    })
    render(<MatcherChipsBar />)
    expect(screen.getByLabelText('Label value')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Label value'), 'xfs{enter}')
    expect(useUIStore.getState().filters.labelMatchers[0].value).toBe('ext4|xfs')
  })

  it('collapses multiple values to one when switching back to =', async () => {
    useUIStore.setState({
      filters: {
        state: 'active',
        search: '',
        labelMatchers: [{ id: 'm1', name: 'fstype', operator: '=~', value: 'ext4|xfs' }],
      },
    })
    render(<MatcherChipsBar />)
    await userEvent.click(screen.getByLabelText('Operator'))
    await userEvent.click(screen.getByRole('button', { name: '=' }))
    expect(useUIStore.getState().filters.labelMatchers[0]).toMatchObject({
      operator: '=',
      value: 'ext4',
    })
  })
})
