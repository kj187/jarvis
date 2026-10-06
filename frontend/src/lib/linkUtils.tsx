import type { ReactNode } from 'react'

const URL_PATTERN = /https?:\/\/[^\s)>\]"']+/g
const URL_START_RE = /^https?:\/\//

export function isUrl(value: string): boolean {
  return URL_START_RE.test(value)
}

function composeRunbookUrl(base: string, raw: string): string | null {
  try {
    const baseUrl = new URL(base)
    const url = new URL(`${base}${raw}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.origin !== baseUrl.origin) return null
    return url.toString()
  } catch {
    return null
  }
}

export type LinkButton = {
  label: string
  url: string
  isRunbook: boolean
}

const SKIP_KEYS = new Set(['summary', 'description'])

export function extractLinkButtons(
  labels: Record<string, string>,
  annotations: Record<string, string>,
  runbookBaseUrl?: string,
): LinkButton[] {
  const map = new Map<string, LinkButton>()

  for (const [key, value] of Object.entries(labels)) {
    if (SKIP_KEYS.has(key)) continue
    if (isUrl(value)) {
      map.set(key, { label: key, url: value, isRunbook: key === 'runbook' })
    }
  }

  for (const [key, value] of Object.entries(annotations)) {
    if (SKIP_KEYS.has(key)) continue
    if (map.has(key)) continue
    if (isUrl(value)) {
      map.set(key, { label: key, url: value, isRunbook: key === 'runbook' })
    }
  }

  if (!map.has('runbook')) {
    const runbookRaw = labels['runbook'] ?? annotations['runbook']
    if (runbookRaw && runbookBaseUrl) {
      const url = composeRunbookUrl(runbookBaseUrl, runbookRaw)
      if (url) map.set('runbook', { label: 'runbook', url, isRunbook: true })
    }
  }

  return Array.from(map.values())
}

export function renderTextWithLinks(text: string): ReactNode {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  const pattern = new RegExp(URL_PATTERN.source, 'g')
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    const url = match[0]
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline-offset-2 hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>,
    )
    lastIndex = match.index + url.length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.length === 0 ? text : <>{parts}</>
}
