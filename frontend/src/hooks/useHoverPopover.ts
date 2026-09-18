import { useCallback, useRef } from 'react'
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react'

/**
 * Wiring for a header-style popover that opens on hover AND is fully
 * keyboard-operable.
 *
 * Hover: `show()` opens immediately, `hide()` closes after `closeDelayMs` so
 * moving the pointer across the gap between trigger and panel doesn't
 * flicker-close it.
 *
 * Keyboard/touch: spread `wrapperProps` on the element wrapping trigger and
 * panel (mouse enter/leave, Escape closes and returns focus to the element
 * marked `data-popover-trigger`, focus leaving the wrapper closes) and
 * `triggerProps` on the trigger `<button>` (`aria-expanded`, and a click
 * handler that toggles when activated from the keyboard but only opens for a
 * mouse click, since the pointer already opened it via hover).
 *
 * Takes the open state itself rather than owning it, so callers can share one
 * boolean between this behavior (desktop) and a plain click-toggle (mobile)
 * driving the same popover.
 */
export function useHoverPopover(open: boolean, setOpen: (open: boolean) => void, closeDelayMs = 120) {
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  const show = useCallback(() => {
    cancelClose()
    setOpen(true)
  }, [cancelClose, setOpen])

  const hide = useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), closeDelayMs)
  }, [cancelClose, setOpen, closeDelayMs])

  const close = useCallback(() => {
    cancelClose()
    setOpen(false)
  }, [cancelClose, setOpen])

  const onClick = (e: MouseEvent<HTMLElement>) => {
    // detail === 0: click synthesized by Enter/Space, i.e. keyboard activation.
    if (e.detail === 0) {
      cancelClose()
      setOpen(!open)
    } else {
      show()
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || !open) return
    close()
    e.currentTarget.querySelector<HTMLElement>('[data-popover-trigger]')?.focus()
  }

  const onBlur = (e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close()
  }

  return {
    show,
    hide,
    close,
    wrapperProps: { onMouseEnter: show, onMouseLeave: hide, onKeyDown, onBlur },
    triggerProps: { onClick, 'aria-expanded': open, 'data-popover-trigger': true },
  }
}
