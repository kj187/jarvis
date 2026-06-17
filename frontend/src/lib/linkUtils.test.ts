import { describe, it, expect } from 'vitest'
import { isUrl, extractLinkButtons } from './linkUtils'

describe('isUrl', () => {
  it('returns true for http URLs', () => {
    expect(isUrl('http://example.com')).toBe(true)
  })

  it('returns true for https URLs', () => {
    expect(isUrl('https://example.com/path?foo=bar')).toBe(true)
  })

  it('returns false for plain strings', () => {
    expect(isUrl('my-runbook-slug')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isUrl('')).toBe(false)
  })

  it('returns false for strings containing a URL but not starting with one', () => {
    expect(isUrl('see https://example.com')).toBe(false)
  })
})

describe('extractLinkButtons', () => {
  it('returns empty array when no labels/annotations contain URLs', () => {
    const result = extractLinkButtons(
      { alertname: 'TestAlert', severity: 'warning' },
      { summary: 'Something happened', description: 'Details here' },
    )
    expect(result).toHaveLength(0)
  })

  it('creates a button for each label with a URL value', () => {
    const result = extractLinkButtons(
      { dashboard: 'https://grafana.example.com/d/abc', alertname: 'Test' },
      {},
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ label: 'dashboard', url: 'https://grafana.example.com/d/abc', isRunbook: false })
  })

  it('creates a button for each annotation with a URL value', () => {
    const result = extractLinkButtons(
      {},
      { link: 'https://jira.example.com/TICKET-1', summary: 'text' },
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ label: 'link', url: 'https://jira.example.com/TICKET-1', isRunbook: false })
  })

  it('skips summary and description annotations', () => {
    const result = extractLinkButtons(
      {},
      { summary: 'https://example.com', description: 'https://example.com' },
    )
    expect(result).toHaveLength(0)
  })

  it('skips summary and description labels', () => {
    const result = extractLinkButtons(
      { summary: 'https://example.com', description: 'https://example.com' },
      {},
    )
    expect(result).toHaveLength(0)
  })

  it('labels take precedence over annotations for same key', () => {
    const result = extractLinkButtons(
      { dashboard: 'https://labels.example.com/d/1' },
      { dashboard: 'https://annotations.example.com/d/2' },
    )
    expect(result).toHaveLength(1)
    expect(result[0].url).toBe('https://labels.example.com/d/1')
  })

  it('marks runbook label URL as isRunbook=true', () => {
    const result = extractLinkButtons(
      { runbook: 'https://wiki.example.com/runbook/alert' },
      {},
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ label: 'runbook', isRunbook: true })
  })

  it('marks runbook annotation URL as isRunbook=true', () => {
    const result = extractLinkButtons(
      {},
      { runbook: 'https://wiki.example.com/runbook/alert' },
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ label: 'runbook', isRunbook: true })
  })

  it('constructs runbook URL from base URL + non-URL label value', () => {
    const result = extractLinkButtons(
      { runbook: 'my-alert' },
      {},
      'https://wiki.example.com/runbooks/',
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      label: 'runbook',
      url: 'https://wiki.example.com/runbooks/my-alert',
      isRunbook: true,
    })
  })

  it('constructs runbook URL from base URL + non-URL annotation value', () => {
    const result = extractLinkButtons(
      {},
      { runbook: 'network-down' },
      'https://wiki.example.com/runbooks/',
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      label: 'runbook',
      url: 'https://wiki.example.com/runbooks/network-down',
      isRunbook: true,
    })
  })

  it('excludes runbook when value is not a URL and no runbookBaseUrl', () => {
    const result = extractLinkButtons(
      { runbook: 'my-alert-slug' },
      {},
    )
    expect(result).toHaveLength(0)
  })

  it('uses runbook URL directly when already absolute, ignoring runbookBaseUrl', () => {
    const result = extractLinkButtons(
      { runbook: 'https://wiki.example.com/explicit' },
      {},
      'https://wiki.example.com/runbooks/',
    )
    expect(result).toHaveLength(1)
    expect(result[0].url).toBe('https://wiki.example.com/explicit')
  })

  it('prefers runbook label over annotation for base URL resolution', () => {
    const result = extractLinkButtons(
      { runbook: 'from-label' },
      { runbook: 'from-annotation' },
      'https://wiki.example.com/runbooks/',
    )
    expect(result).toHaveLength(1)
    expect(result[0].url).toBe('https://wiki.example.com/runbooks/from-label')
  })

  it('handles multiple URL labels and annotations simultaneously', () => {
    const result = extractLinkButtons(
      { runbook: 'https://wiki.example.com/rb', alertname: 'Test' },
      { dashboard: 'https://grafana.example.com/d/1', link: 'https://jira.example.com/T-1', summary: 'text' },
    )
    expect(result).toHaveLength(3)
    const labels = result.map((b) => b.label)
    expect(labels).toContain('runbook')
    expect(labels).toContain('dashboard')
    expect(labels).toContain('link')
    expect(labels).not.toContain('alertname')
    expect(labels).not.toContain('summary')
  })

  it('handles arbitrary custom link labels', () => {
    const result = extractLinkButtons(
      { 'ticket_url': 'https://jira.example.com/ABC-123' },
      {},
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ label: 'ticket_url', url: 'https://jira.example.com/ABC-123', isRunbook: false })
  })
})
