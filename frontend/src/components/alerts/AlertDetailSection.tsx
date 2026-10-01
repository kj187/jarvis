import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AlertDetailSectionProps {
  title: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  headerRight?: ReactNode
  testId?: string
  /** Divider below the section. Default true; set false for sections that
   * flow into the next one without a visual break. */
  bordered?: boolean
  /** When set, the open/closed state is remembered in localStorage under this key (shared across alerts). */
  persistKey?: string
}

export function AlertDetailSection({
  title,
  children,
  defaultOpen = true,
  headerRight,
  testId,
  bordered = true,
  persistKey,
}: AlertDetailSectionProps) {
  const storageKey = persistKey ? `jarvis:detail-section:${persistKey}` : null
  const [open, setOpen] = useState(() => {
    if (!storageKey) return defaultOpen
    try {
      const stored = localStorage.getItem(storageKey)
      return stored === null ? defaultOpen : stored === 'open'
    } catch {
      return defaultOpen
    }
  })

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (!storageKey) return
    try { localStorage.setItem(storageKey, next ? 'open' : 'closed') } catch {}
  }

  return (
    <div data-testid={testId} className={cn('py-4 px-5', bordered && 'border-b border-border')}>
      <button
        className="flex w-full items-center justify-between text-sm font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer"
        onClick={toggle}
      >
        <span className="flex items-center gap-1.5">{title}</span>
        <div className="flex items-center gap-2">
          {headerRight && (
            <span onClick={(e) => e.stopPropagation()}>{headerRight}</span>
          )}
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  )
}
