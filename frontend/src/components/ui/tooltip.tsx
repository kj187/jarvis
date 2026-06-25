import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

interface TooltipProps {
  /** Tooltip content. When empty/falsy the trigger is rendered without a tooltip. */
  content: React.ReactNode
  side?: TooltipSide
  /** Delay in ms before the tooltip appears on hover/focus. */
  delayMs?: number
  /** Classes for the floating tooltip bubble. */
  className?: string
  /** Classes for the inline wrapper around the trigger. */
  wrapperClassName?: string
  children: React.ReactNode
}

const GAP = 8

export function Tooltip({
  content,
  side = 'top',
  delayMs = 200,
  className,
  wrapperClassName,
  children,
}: TooltipProps) {
  const [open, setOpen] = React.useState(false)
  const [coords, setCoords] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const triggerRef = React.useRef<HTMLSpanElement>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined)

  const position = React.useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    switch (side) {
      case 'bottom':
        setCoords({ top: r.bottom + GAP, left: r.left + r.width / 2 })
        break
      case 'left':
        setCoords({ top: r.top + r.height / 2, left: r.left - GAP })
        break
      case 'right':
        setCoords({ top: r.top + r.height / 2, left: r.right + GAP })
        break
      default:
        setCoords({ top: r.top - GAP, left: r.left + r.width / 2 })
    }
  }, [side])

  const show = React.useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      position()
      setOpen(true)
    }, delayMs)
  }, [delayMs, position])

  const hide = React.useCallback(() => {
    clearTimeout(timer.current)
    setOpen(false)
  }, [])

  React.useEffect(() => () => clearTimeout(timer.current), [])

  React.useEffect(() => {
    if (!open) return
    const handle = () => hide()
    window.addEventListener('scroll', handle, true)
    window.addEventListener('resize', handle)
    return () => {
      window.removeEventListener('scroll', handle, true)
      window.removeEventListener('resize', handle)
    }
  }, [open, hide])

  if (!content) return <>{children}</>

  const transform =
    side === 'top'
      ? 'translate(-50%, -100%)'
      : side === 'bottom'
        ? 'translate(-50%, 0)'
        : side === 'left'
          ? 'translate(-100%, -50%)'
          : 'translate(0, -50%)'

  return (
    <>
      <span
        ref={triggerRef}
        className={cn('inline-flex', wrapperClassName)}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            role="tooltip"
            className={cn(
              'pointer-events-none fixed z-[100] max-w-xs rounded-md border border-border bg-popover px-2.5 py-1.5',
              'text-xs leading-snug text-popover-foreground shadow-lg',
              'whitespace-normal break-words normal-case tracking-normal',
              className,
            )}
            style={{ top: coords.top, left: coords.left, transform }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  )
}
