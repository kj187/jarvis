import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import go from 'highlight.js/lib/languages/go'
import javascript from 'highlight.js/lib/languages/javascript'
import sql from 'highlight.js/lib/languages/sql'
import ini from 'highlight.js/lib/languages/ini'

// Small registered set only — keeps the lazy-loaded chunk from pulling in
// highlight.js's full ~190-language grammar bundle.
const HIGHLIGHT_LANGUAGES = { bash, json, yaml, go, javascript, sql, ini }

// A comment is a note, not a document: no images/headings/tables — anything
// not in this list is silently dropped by react-markdown, not rendered raw.
// `span` must stay allowed even though no Markdown syntax produces it directly:
// rehype-highlight wraps each syntax-highlighted token in a <span class="hljs-*">,
// and react-markdown drops disallowed elements *including their text content* —
// without it, highlighted keywords (e.g. `echo` in a bash fence) silently vanish.
const ALLOWED_ELEMENTS = [
  'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'blockquote', 'span',
]

interface CommentMarkdownProps {
  body: string
}

export default function CommentMarkdown({ body }: CommentMarkdownProps) {
  return (
    <div className="comment-markdown text-sm leading-relaxed break-words">
      <ReactMarkdown
        skipHtml
        allowedElements={ALLOWED_ELEMENTS}
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { languages: HIGHLIGHT_LANGUAGES }]]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-link underline decoration-dotted hover:decoration-solid">
              {children}
            </a>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  )
}
