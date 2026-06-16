import type { ReactNode } from 'react'

const URL_PATTERN = /https?:\/\/[^\s)>\]"']+/g

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
        className="underline underline-offset-2 text-blue-400 hover:text-blue-300"
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
