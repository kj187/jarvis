import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LabelChip, labelColorStyle } from './LabelChip'
import { useUIStore } from '@/store/uiStore'

beforeEach(() => {
  useUIStore.setState({ filters: { state: '', search: '', labelMatchers: [] } })
})

describe('LabelChip', () => {
  it('renders label key and value', () => {
    render(<LabelChip labelKey="job" value="node" />)
    expect(screen.getByText('job: node')).toBeInTheDocument()
  })

  it('does not show dropdown initially', () => {
    render(<LabelChip labelKey="job" value="node" />)
    expect(screen.queryByText('=')).not.toBeInTheDocument()
  })

  it('shows operator dropdown on mouseenter', () => {
    render(<LabelChip labelKey="job" value="node" />)
    fireEvent.mouseEnter(screen.getByText('job: node').parentElement!)
    expect(screen.getByText('=')).toBeInTheDocument()
    expect(screen.getByText('!=')).toBeInTheDocument()
    expect(screen.getByText('=~')).toBeInTheDocument()
    expect(screen.getByText('!~')).toBeInTheDocument()
  })

  it('applies = filter when = operator clicked', () => {
    render(<LabelChip labelKey="job" value="node" />)
    fireEvent.mouseEnter(screen.getByText('job: node').parentElement!)
    fireEvent.click(screen.getByText('='))
    const matchers = useUIStore.getState().filters.labelMatchers
    expect(matchers).toHaveLength(1)
    expect(matchers[0]).toMatchObject({ name: 'job', operator: '=', value: 'node' })
  })

  it('applies != filter when != operator clicked', () => {
    render(<LabelChip labelKey="env" value="prod" />)
    fireEvent.mouseEnter(screen.getByText('env: prod').parentElement!)
    fireEvent.click(screen.getByText('!='))
    const matchers = useUIStore.getState().filters.labelMatchers
    expect(matchers[0]).toMatchObject({ name: 'env', operator: '!=', value: 'prod' })
  })
})

describe('labelColorStyle', () => {
  it('returns an object with backgroundColor, color, borderColor', () => {
    const style = labelColorStyle('severity')
    expect(style).toHaveProperty('backgroundColor')
    expect(style).toHaveProperty('color')
    expect(style).toHaveProperty('borderColor')
  })

  it('returns different styles for different keys', () => {
    const s1 = labelColorStyle('job')
    const s2 = labelColorStyle('env')
    expect(s1.backgroundColor).not.toBe(s2.backgroundColor)
  })
})
