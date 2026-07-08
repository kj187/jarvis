import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SheetProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  className?: string
  testId?: string
  closeTestId?: string
  /** Accessible name for the dialog when there is no visible title to reference. */
  ariaLabel?: string
  /** id of a visible element (e.g. the heading) that labels the dialog. Takes precedence over ariaLabel. */
  ariaLabelledby?: string
  /** Suppress the default top-right close button when the consumer renders its own. */
  hideCloseButton?: boolean
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

// Stack of currently open sheets. Only the top-most sheet reacts to Escape and
// traps Tab focus, so nested sheets (e.g. a silence form opened from the detail
// panel) behave correctly without their parents interfering.
const sheetStack: number[] = []
let sheetSeq = 0

export function Sheet({
  open,
  onClose,
  children,
  className,
  testId,
  closeTestId,
  ariaLabel,
  ariaLabelledby,
  hideCloseButton,
}: SheetProps) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const idRef = React.useRef(0)

  // Register this sheet on the open-sheet stack while it is open.
  React.useEffect(() => {
    if (!open) return
    const id = ++sheetSeq
    idRef.current = id
    sheetStack.push(id)
    return () => {
      const i = sheetStack.indexOf(id)
      if (i !== -1) sheetStack.splice(i, 1)
    }
  }, [open])

  const isTopmost = React.useCallback(
    () => sheetStack[sheetStack.length - 1] === idRef.current,
    [],
  )

  // Escape closes only the top-most sheet.
  React.useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopmost()) onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose, isTopmost])

  // Lock body scroll while open.
  React.useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Move focus into the dialog on open and restore it to the previously focused
  // element (e.g. the alert row that opened the panel) on close.
  React.useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => {
      previouslyFocused?.focus?.()
    }
  }, [open])

  if (!open) return null

  // Keep Tab focus within the dialog (focus trap).
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !isTopmost()) return
    const panel = panelRef.current
    if (!panel) return

    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement)

    if (focusables.length === 0) {
      e.preventDefault()
      panel.focus()
      return
    }

    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement as HTMLElement | null

    if (e.shiftKey) {
      if (active === first || !panel.contains(active)) {
        e.preventDefault()
        last.focus()
      }
    } else if (active === last || !panel.contains(active)) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabelledby ? undefined : ariaLabel}
        aria-labelledby={ariaLabelledby}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        data-testid={testId}
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-card shadow-xl focus:outline-none',
          'sm:max-w-2xl lg:max-w-4xl',
          className,
        )}
      >
        {!hideCloseButton && (
          <button
            data-testid={closeTestId}
            onClick={onClose}
            className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <div className="sheet-scroll flex-1 overflow-y-auto">{children}</div>
      </div>
    </>
  )
}
