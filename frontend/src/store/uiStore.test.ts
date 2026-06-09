import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from './uiStore'

const defaultState = {
  viewMode: 'card' as const,
  selectedFingerprint: null,
  filters: { state: 'active', search: '', labelMatchers: [] },
  wsConnected: false,
  pollingPaused: false,
  alertCounts: { filtered: 0, total: 0, byState: { active: 0, suppressed: 0, resolved: 0 } },
}

beforeEach(() => {
  useUIStore.setState(defaultState)
})

describe('setViewMode', () => {
  it('switches to list mode', () => {
    useUIStore.getState().setViewMode('list')
    expect(useUIStore.getState().viewMode).toBe('list')
  })

  it('switches back to card mode', () => {
    useUIStore.setState({ viewMode: 'list' })
    useUIStore.getState().setViewMode('card')
    expect(useUIStore.getState().viewMode).toBe('card')
  })
})

describe('setSelectedFingerprint', () => {
  it('sets a fingerprint', () => {
    useUIStore.getState().setSelectedFingerprint('abc123')
    expect(useUIStore.getState().selectedFingerprint).toBe('abc123')
  })

  it('clears the fingerprint', () => {
    useUIStore.setState({ selectedFingerprint: 'abc123' })
    useUIStore.getState().setSelectedFingerprint(null)
    expect(useUIStore.getState().selectedFingerprint).toBeNull()
  })
})

describe('setFilter', () => {
  it('sets state filter', () => {
    useUIStore.getState().setFilter('state', 'suppressed')
    expect(useUIStore.getState().filters.state).toBe('suppressed')
  })

  it('sets search filter', () => {
    useUIStore.getState().setFilter('search', 'disk')
    expect(useUIStore.getState().filters.search).toBe('disk')
  })

  it('does not overwrite other filters', () => {
    useUIStore.setState({ filters: { state: 'active', search: 'foo', labelMatchers: [] } })
    useUIStore.getState().setFilter('state', 'suppressed')
    expect(useUIStore.getState().filters.search).toBe('foo')
  })
})

describe('addLabelMatcher', () => {
  it('adds a matcher with auto-generated id', () => {
    useUIStore.getState().addLabelMatcher({ name: 'job', operator: '=', value: 'node' })
    const matchers = useUIStore.getState().filters.labelMatchers
    expect(matchers).toHaveLength(1)
    expect(matchers[0]).toMatchObject({ name: 'job', operator: '=', value: 'node' })
    expect(matchers[0].id).toBeTruthy()
  })

  it('adds multiple matchers', () => {
    useUIStore.getState().addLabelMatcher({ name: 'job', operator: '=', value: 'node' })
    useUIStore.getState().addLabelMatcher({ name: 'env', operator: '!=', value: 'prod' })
    expect(useUIStore.getState().filters.labelMatchers).toHaveLength(2)
  })
})

describe('updateLabelMatcher', () => {
  it('updates value of existing matcher', () => {
    useUIStore.getState().addLabelMatcher({ name: 'job', operator: '=', value: 'old' })
    const id = useUIStore.getState().filters.labelMatchers[0].id
    useUIStore.getState().updateLabelMatcher(id, { value: 'new' })
    expect(useUIStore.getState().filters.labelMatchers[0].value).toBe('new')
  })

  it('updates operator of existing matcher', () => {
    useUIStore.getState().addLabelMatcher({ name: 'job', operator: '=', value: 'node' })
    const id = useUIStore.getState().filters.labelMatchers[0].id
    useUIStore.getState().updateLabelMatcher(id, { operator: '!=' })
    expect(useUIStore.getState().filters.labelMatchers[0].operator).toBe('!=')
  })

  it('ignores unknown id', () => {
    useUIStore.getState().addLabelMatcher({ name: 'job', operator: '=', value: 'node' })
    useUIStore.getState().updateLabelMatcher('nonexistent', { value: 'changed' })
    expect(useUIStore.getState().filters.labelMatchers[0].value).toBe('node')
  })
})

describe('removeLabelMatcher', () => {
  it('removes the correct matcher', () => {
    useUIStore.getState().addLabelMatcher({ name: 'job', operator: '=', value: 'node' })
    useUIStore.getState().addLabelMatcher({ name: 'env', operator: '=', value: 'prod' })
    const id = useUIStore.getState().filters.labelMatchers[0].id
    useUIStore.getState().removeLabelMatcher(id)
    const matchers = useUIStore.getState().filters.labelMatchers
    expect(matchers).toHaveLength(1)
    expect(matchers[0].name).toBe('env')
  })

  it('does nothing for unknown id', () => {
    useUIStore.getState().addLabelMatcher({ name: 'job', operator: '=', value: 'node' })
    useUIStore.getState().removeLabelMatcher('nonexistent')
    expect(useUIStore.getState().filters.labelMatchers).toHaveLength(1)
  })
})

describe('clearLabelMatchers', () => {
  it('removes all matchers', () => {
    useUIStore.getState().addLabelMatcher({ name: 'job', operator: '=', value: 'node' })
    useUIStore.getState().addLabelMatcher({ name: 'env', operator: '=', value: 'prod' })
    useUIStore.getState().clearLabelMatchers()
    expect(useUIStore.getState().filters.labelMatchers).toHaveLength(0)
  })
})

describe('resetFilters', () => {
  it('resets all filters to defaults', () => {
    useUIStore.setState({
      filters: { state: 'suppressed', search: 'disk', labelMatchers: [{ id: '1', name: 'job', operator: '=', value: 'node' }] },
    })
    useUIStore.getState().resetFilters()
    expect(useUIStore.getState().filters.state).toBe('active')
    expect(useUIStore.getState().filters.search).toBe('')
    expect(useUIStore.getState().filters.labelMatchers).toHaveLength(0)
  })
})

describe('setWsConnected', () => {
  it('marks as connected', () => {
    useUIStore.getState().setWsConnected(true)
    expect(useUIStore.getState().wsConnected).toBe(true)
  })

  it('marks as disconnected', () => {
    useUIStore.setState({ wsConnected: true })
    useUIStore.getState().setWsConnected(false)
    expect(useUIStore.getState().wsConnected).toBe(false)
  })
})

describe('setPollingPaused', () => {
  it('pauses polling', () => {
    useUIStore.getState().setPollingPaused(true)
    expect(useUIStore.getState().pollingPaused).toBe(true)
  })

  it('resumes polling', () => {
    useUIStore.setState({ pollingPaused: true })
    useUIStore.getState().setPollingPaused(false)
    expect(useUIStore.getState().pollingPaused).toBe(false)
  })
})

describe('setAlertCounts', () => {
  it('updates all count fields', () => {
    const counts = { filtered: 3, total: 10, byState: { active: 5, suppressed: 2, resolved: 3 } }
    useUIStore.getState().setAlertCounts(counts)
    expect(useUIStore.getState().alertCounts).toEqual(counts)
  })
})
