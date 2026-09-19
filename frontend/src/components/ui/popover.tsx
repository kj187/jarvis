import * as React from 'react'
import { useHoverPopover } from '@/hooks/useHoverPopover'
import { cn } from '@/lib/utils'

/** Props to spread on the trigger `<button>` so it is keyboard-operable and announces its state. */
export interface PopoverTriggerProps {
  onClick: React.MouseEventHandler<HTMLElement>
  'aria-expanded': boolean
  'aria-controls': string
  'data-popover-trigger': boolean
}

interface PopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Renders the trigger. Spread `props` on a real button; `panelId`/`open` are for `aria-describedby`-style links. */
  trigger: (ctx: { props: PopoverTriggerProps; panelId: string; open: boolean }) => React.ReactNode
  /** Panel content, rendered only while open. */
  children: React.ReactNode
  /** Wrapper classes (positioning context for the panel). */
  className?: string
  /** Panel classes: position, width, surface. */
  panelClassName?: string
  /** `region` (default) for interactive content, `tooltip` for a plain hint. */
  role?: 'region' | 'tooltip' | 'menu' | 'dialog'
  /** Accessible name of the panel (needed for `region`/`dialog`). */
  label?: string
  /** Also open when focus enters (hint-style popovers). Menus open on activation instead. */
  openOnFocus?: boolean
  /** Extra attributes on the panel, e.g. a `data-testid`. */
  panelProps?: React.HTMLAttributes<HTMLDivElement> & { [data: `data-${string}`]: string }
}

/**
 * Non-modal popover: opens on hover, Enter/Space or (optionally) focus, closes on Escape — focus
 * returns to the trigger — or when focus leaves. Never hover-only: everything reachable with the
 * pointer is reachable from the keyboard. Modal content belongs in `Dialog`/`Sheet`; a short,
 * non-interactive hint belongs in `Tooltip`.
 */
export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  className,
  panelClassName,
  role = 'region',
  label,
  openOnFocus = false,
  panelProps,
}: PopoverProps) {
  const panelId = React.useId()
  const pop = useHoverPopover(open, onOpenChange)
  const wrapper = openOnFocus ? { ...pop.wrapperProps, onFocus: pop.show } : pop.wrapperProps
  return (
    <div className={className} {...wrapper}>
      {trigger({ props: { ...pop.triggerProps, 'aria-controls': panelId }, panelId, open })}
      {open && (
        <div
          id={panelId}
          role={role}
          aria-label={label}
          className={cn(panelClassName)}
          onMouseEnter={pop.show}
          onMouseLeave={pop.hide}
          {...panelProps}
        >
          {children}
        </div>
      )}
    </div>
  )
}
