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
  /**
   * `region` (default) for interactive content, `group` for a small set of related controls,
   * `tooltip` for a plain hint. Deliberately no `menu`: that role promises arrow-key roving
   * focus and owned `menuitem` children, which this primitive does not implement.
   */
  role?: 'region' | 'tooltip' | 'group' | 'dialog'
  /** Accessible name of the panel (needed for `region`/`group`/`dialog`). */
  label?: string
  /** Also open when focus enters (hint-style popovers). Menus open on activation instead. */
  openOnFocus?: boolean
  /** Extra attributes on the panel, e.g. a `data-testid`. */
  panelProps?: React.HTMLAttributes<HTMLDivElement> & { [data: `data-${string}`]: string }
  /** Ref to the panel element, for callers that measure it (e.g. to align it over its trigger). */
  panelRef?: React.Ref<HTMLDivElement>
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
  panelRef,
}: PopoverProps) {
  const panelId = React.useId()
  const pop = useHoverPopover(open, onOpenChange)
  const wrapper = openOnFocus ? { ...pop.wrapperProps, onFocus: pop.show } : pop.wrapperProps
  return (
    <div className={className} {...wrapper}>
      {trigger({ props: { ...pop.triggerProps, 'aria-controls': panelId }, panelId, open })}
      {open && (
        <div
          ref={panelRef}
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
