import * as React from 'react'
import { Info } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface InfoHintProps {
  /** The explanation shown on hover and keyboard focus. */
  children: React.ReactNode
  /** Accessible name of the (icon-only) trigger button. */
  label?: string
  /** Icon size: `sm` 12 px for dense headers, `md` 14 px. */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * An "(i)" that explains a heading or setting. A real button, so it is reachable with Tab; the
 * explanation opens on hover and focus, closes with Escape, and is linked to the button with
 * `aria-describedby`. Use `Tooltip` for other short, non-interactive hints.
 */
export function InfoHint({ children, label = 'More information', size = 'md', className }: InfoHintProps) {
  const id = React.useId()
  return (
    <Tooltip content={children} side="bottom" id={id} className="w-72 max-w-none">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        className={cn(
          'inline-flex cursor-help items-center rounded-compact text-muted-foreground transition-colors',
          'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
      >
        <Info className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      </button>
    </Tooltip>
  )
}
