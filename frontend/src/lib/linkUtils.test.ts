import { describe, expect, it } from 'vitest'
import { extractLinkButtons } from './linkUtils'

describe('extractLinkButtons runbook composition', () => {
  it('joins a relative runbook onto an https base URL', () => {
    const links = extractLinkButtons({}, { runbook: 'disk-full' }, 'https://wiki.example.com/runbooks/')
    expect(links).toEqual([
      { label: 'runbook', url: 'https://wiki.example.com/runbooks/disk-full', isRunbook: true },
    ])
  })

  it('drops a runbook when the base URL is not http(s)', () => {
    expect(extractLinkButtons({}, { runbook: 'x' }, 'javascript:alert(1)//')).toEqual([])
  })

  it('drops a runbook whose composed URL escapes the base origin', () => {
    expect(extractLinkButtons({}, { runbook: '@evil.example/x' }, 'https://wiki.example.com')).toEqual([])
  })

  it('does not render javascript: annotations as links', () => {
    expect(extractLinkButtons({}, { runbook_url: 'javascript:alert(1)' })).toEqual([])
  })
})
