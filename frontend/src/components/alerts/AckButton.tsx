import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { BellOff, Check, ChevronDown, ChevronUp, Loader2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoginModal } from '@/components/auth/LoginModal'
import { useAckAlert } from '@/hooks/useSilences'
import { useProtectedAction } from '@/hooks/useProtectedAction'
import { getEffectiveAlertState, FAST_SILENCE_DURATIONS } from '@/lib/alertUtils'
import { cn } from '@/lib/utils'
import type { EnrichedAlert, Silence } from '@/types'

interface AckButtonProps {
  alert: EnrichedAlert
  silences: Silence[]
  /** `card` = compact chip for the card entry, `detail` = full button for the detail panel. */
  variant?: 'card' | 'detail'
}

type FeedbackState = 'idle' | 'done' | 'error'

/** How long the transient success/error label stays visible after a pick. */
const FEEDBACK_MS = 2500
/** Grace period before the hover menu closes, so the pointer can cross the gap. */
const MENU_CLOSE_MS = 140
/** Vertical gap between the trigger and the menu. */
const GAP = 6
/** Rough menu height used to decide whether it still fits above the trigger. */
const MENU_EST_HEIGHT = FAST_SILENCE_DURATIONS.length * 28 + 32

/**
 * One-click Fast-Silence button with a duration menu. Hovering (or clicking /
 * focusing) the button opens a small popover listing the durations from
 * `FAST_SILENCE_DURATIONS` (30m, 1h, 4h, 1d, 1w); clicking one creates a
 * short-lived exact-match silence for exactly this alert for that duration — no
 * form, no modal. The comment reflects the chosen duration. The menu prefers to
 * open *above* the button and flips below when there is not enough room.
 *
 * Rendered only when the alert's effective state is `active` (invariant #3);
 * hidden for suppressed/resolved alerts. Auth is gated via `useProtectedAction`
 * so `write_protect` mode opens the login modal. After a pick the button shows
 * a transient success/error label so the action is visibly confirmed even before
 * the next poll flips the alert to suppressed.
 */
export function AckButton({ alert, silences, variant = 'detail' }: AckButtonProps) {
  const { ack, isPending } = useAckAlert()
  const [feedback, setFeedback] = useState<FeedbackState>('idle')
  const [menuOpen, setMenuOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [placeAbove, setPlaceAbove] = useState(true)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const triggerRef = useRef<HTMLDivElement>(null)
  const durationRef = useRef<number>(FAST_SILENCE_DURATIONS[0].minutes)

  useEffect(
    () => () => {
      clearTimeout(feedbackTimer.current)
      clearTimeout(closeTimer.current)
    },
    [],
  )

  const flash = useCallback((state: FeedbackState) => {
    setFeedback(state)
    clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => setFeedback('idle'), FEEDBACK_MS)
  }, [])

  const action = useCallback(async () => {
    try {
      await ack(alert, durationRef.current)
      flash('done')
    } catch {
      flash('error')
    }
  }, [ack, alert, flash])

  const { execute, loginModalOpen, onLoginSuccess, onLoginClose } = useProtectedAction(action)

  const position = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const above = r.top >= MENU_EST_HEIGHT + GAP
    setPlaceAbove(above)
    setCoords({ top: above ? r.top - GAP : r.bottom + GAP, left: r.left })
  }, [])

  const openMenu = useCallback(() => {
    clearTimeout(closeTimer.current)
    position()
    setMenuOpen(true)
  }, [position])

  const scheduleClose = useCallback(() => {
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setMenuOpen(false), MENU_CLOSE_MS)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menuOpen])

  if (getEffectiveAlertState(alert, silences) !== 'active') return null

  const label = feedback === 'done' ? 'Silenced' : feedback === 'error' ? 'Failed' : 'Fast-Silence'

  const icon = (size: string) => {
    if (isPending) return <Loader2 className={cn(size, 'animate-spin')} />
    if (feedback === 'done') return <Check className={size} />
    if (feedback === 'error') return <TriangleAlert className={size} />
    return variant === 'card' ? <Check className={size} /> : <BellOff className={size} />
  }

  const pick = (minutes: number) => (e: MouseEvent) => {
    e.stopPropagation()
    durationRef.current = minutes
    clearTimeout(closeTimer.current)
    setMenuOpen(false)
    execute()
  }

  const toggleMenu = (e: MouseEvent) => {
    e.stopPropagation()
    setMenuOpen((prev) => {
      if (!prev) position()
      return !prev
    })
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setMenuOpen(false)
  }

  const Chevron = menuOpen && !placeAbove ? ChevronDown : ChevronUp

  return (
    <>
      <div
        ref={triggerRef}
        className="inline-flex"
        onMouseEnter={openMenu}
        onMouseLeave={scheduleClose}
        onFocus={openMenu}
        onBlur={scheduleClose}
        onKeyDown={handleKeyDown}
      >
        {variant === 'card' ? (
          <button
            type="button"
            data-testid="alert-ack-button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Fast-Silence this alert"
            onClick={toggleMenu}
            disabled={isPending}
            className={cn(
              'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium cursor-pointer disabled:opacity-50',
              feedback === 'error'
                ? 'border-destructive/40 bg-card text-destructive'
                : feedback === 'done'
                  ? 'border-emerald-500/40 bg-card text-emerald-600 dark:text-emerald-400'
                  : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {icon('h-3 w-3')}
            {label}
            <Chevron className="h-3 w-3 opacity-60" />
          </button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            data-testid="alert-ack-button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Fast-Silence this alert"
            onClick={toggleMenu}
            disabled={isPending}
            className={
              feedback === 'error'
                ? 'text-destructive'
                : feedback === 'done'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : undefined
            }
          >
            {icon('h-3.5 w-3.5')}
            {label}
            <Chevron className="h-3.5 w-3.5 opacity-60" />
          </Button>
        )}
      </div>

      {menuOpen &&
        createPortal(
          <div
            role="menu"
            data-testid="alert-ack-menu"
            onMouseEnter={() => clearTimeout(closeTimer.current)}
            onMouseLeave={scheduleClose}
            className="fixed z-[100] min-w-[8rem] rounded-md border border-border bg-popover p-1 shadow-lg"
            style={{
              top: coords.top,
              left: coords.left,
              transform: placeAbove ? 'translateY(-100%)' : undefined,
            }}
          >
            <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Silence for…
            </p>
            {FAST_SILENCE_DURATIONS.map((d) => (
              <button
                key={d.minutes}
                type="button"
                role="menuitem"
                data-testid="alert-ack-option"
                onClick={pick(d.minutes)}
                className="flex w-full items-center rounded px-2 py-1 text-left text-xs text-popover-foreground hover:bg-accent hover:text-foreground cursor-pointer"
              >
                {d.label}
              </button>
            ))}
          </div>,
          document.body,
        )}

      <LoginModal open={loginModalOpen} onSuccess={onLoginSuccess} onClose={onLoginClose} />
    </>
  )
}
