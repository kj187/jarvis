import { useCallback, useRef } from 'react'

/**
 * Open-on-hover wiring for a header-style popover: `show()` opens
 * immediately, `hide()` closes after `closeDelayMs` so moving the pointer
 * across the gap between trigger and panel doesn't flicker-close it. Wire
 * both to onMouseEnter/onMouseLeave on the trigger AND the panel itself.
 *
 * Takes the open state's setter rather than owning the state, so callers
 * can share one boolean between this hover behavior (desktop) and a plain
 * click-toggle (mobile) driving the same popover.
 */
export function useHoverPopover(setOpen: (open: boolean) => void, closeDelayMs = 120) {
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }, [setOpen])

  const hide = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), closeDelayMs)
  }, [setOpen, closeDelayMs])

  return { show, hide }
}
