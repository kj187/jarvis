import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AlertBadge, StatusBadge } from './AlertBadge'

describe('AlertBadge', () => {
  it('renders Critical for severity=critical', () => {
    render(<AlertBadge severity="critical" />)
    expect(screen.getByText('Critical')).toBeInTheDocument()
  })

  it('renders Warning for severity=warning', () => {
    render(<AlertBadge severity="warning" />)
    expect(screen.getByText('Warning')).toBeInTheDocument()
  })

  it('renders Info for severity=info', () => {
    render(<AlertBadge severity="info" />)
    expect(screen.getByText('Info')).toBeInTheDocument()
  })

  it('renders None for severity=none', () => {
    render(<AlertBadge severity="none" />)
    expect(screen.getByText('None')).toBeInTheDocument()
  })

  it('renders unknown severity label as-is', () => {
    render(<AlertBadge severity="custom-level" />)
    expect(screen.getByText('custom-level')).toBeInTheDocument()
  })

  it('renders Unknown for empty severity', () => {
    render(<AlertBadge severity="" />)
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })
})

describe('StatusBadge', () => {
  it('renders Active for state=active', () => {
    render(<StatusBadge state="active" />)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('renders Suppressed for state=suppressed', () => {
    render(<StatusBadge state="suppressed" />)
    expect(screen.getByText('Suppressed')).toBeInTheDocument()
  })

  it('renders Resolved for state=resolved', () => {
    render(<StatusBadge state="resolved" />)
    expect(screen.getByText('Resolved')).toBeInTheDocument()
  })

  it('renders Unprocessed for state=unprocessed', () => {
    render(<StatusBadge state="unprocessed" />)
    expect(screen.getByText('Unprocessed')).toBeInTheDocument()
  })

  it('renders unknown state label as-is', () => {
    render(<StatusBadge state="mixed" />)
    expect(screen.getByText('mixed')).toBeInTheDocument()
  })
})
