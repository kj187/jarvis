import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ViewToggle } from './ViewToggle'

describe('ViewToggle', () => {
  it('renders Card View button', () => {
    render(<ViewToggle value="card" onChange={vi.fn()} />)
    expect(screen.getByTitle('Card View')).toBeInTheDocument()
  })

  it('renders List View button', () => {
    render(<ViewToggle value="card" onChange={vi.fn()} />)
    expect(screen.getByTitle('List View')).toBeInTheDocument()
  })

  it('card button has aria-pressed=true when value=card', () => {
    render(<ViewToggle value="card" onChange={vi.fn()} />)
    expect(screen.getByTitle('Card View')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTitle('List View')).toHaveAttribute('aria-pressed', 'false')
  })

  it('list button has aria-pressed=true when value=list', () => {
    render(<ViewToggle value="list" onChange={vi.fn()} />)
    expect(screen.getByTitle('List View')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTitle('Card View')).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onChange with card when Card View clicked', () => {
    const onChange = vi.fn()
    render(<ViewToggle value="list" onChange={onChange} />)
    fireEvent.click(screen.getByTitle('Card View'))
    expect(onChange).toHaveBeenCalledWith('card')
  })

  it('calls onChange with list when List View clicked', () => {
    const onChange = vi.fn()
    render(<ViewToggle value="card" onChange={onChange} />)
    fireEvent.click(screen.getByTitle('List View'))
    expect(onChange).toHaveBeenCalledWith('list')
  })
})
