import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { Bell, BellOff, Check, ChevronDown, ChevronRight, ChevronUp, Loader2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover } from '@/components/ui/popover'
import { useAckAlert, useGroupAckAlert } from '@/hooks/useSilences'
import { useProtectedAction } from '@/hooks/useProtectedAction'
import { getEffectiveAlertState } from '@/lib/alertUtils'
import { formatDurationChoice } from '@/lib/silenceDurations'
import { useSettingsStore } from '@/store/useSettingsStore'
import { cn } from '@/lib/utils'
import type { EnrichedAlert, Silence } from '@/types'

interface AckButtonProps {
  /**
   * Fast-Silence targets. A single-element array is the common per-alert
   * case (invariant #3 applies: hidden/disabled once that one alert isn't
   * active): picking a duration creates one exact-match silence for that
   * alert's real labels. A multi-element array is the card header's "whole
   * visible group" case: picking a duration creates one broader silence per
   * cluster represented in the group (normally just one), using the same
   * common-vs-varying label matchers `SilenceForm`'s group prefill would
   * default to (`buildGroupAckSilenceBody`) — not a fan-out of one silence
   * per alert, which doesn't hold up at group sizes of a dozen-plus alerts.
   */
  alerts: EnrichedAlert[]
  silences: Silence[]
  /**
   * `card` = compact text+icon chip, `detail` = full button for the detail
   * panel, `icon` = bare icon button (no label) for a persistent action rail.
   */
  variant?: 'card' | 'detail' | 'icon'
  /**
   * Fires whenever the button+menu should be considered "in use" (menu open,
   * request pending, or a transient feedback label showing). Callers that
   * only reveal the trigger on hover (e.g. `AlertCard`'s `group-hover`) use
   * this to keep it visible while the pointer is over the portaled menu,
   * which lives outside the hover group's DOM subtree.
   */
  onOpenChange?: (open: boolean) => void
  /**
   * When provided, the menu gains a "Silence…" entry above the Fast-Silence
   * durations that opens the full pre-filled silence form for these alerts
   * instead. Used where one bell icon needs to offer both the deliberate
   * (form) and the fast (one-click) path — currently the card view, where a
   * separate icon for each read as two different actions (see `variant:
   * 'icon'`'s shared `Bell` icon with the card header's silence button).
   */
  onCreateSilence?: (alerts: EnrichedAlert[]) => void
  /**
   * Hide entirely when none of `alerts` is currently active (invariant #3).
   * Default true, matching every per-alert usage. The card header passes
   * false: its "Silence…" form link stays useful regardless of alert state,
   * even though the Fast-Silence duration section hides itself once there is
   * nothing active left to target.
   */
  requireActive?: boolean
  /**
   * Deliberately recessive styling (low-contrast idle color) for the `icon`
   * variant's persistent, always-visible placement. The card header — where
   * this is the primary, clearly-visible action — passes false.
   */
  subtle?: boolean
}

type FeedbackState = 'idle' | 'done' | 'error'

/** How long the transient success/error label stays visible after a pick. */
const FEEDBACK_MS = 2500
/** Vertical gap between the trigger and the menu. */
const GAP = 6
/** Fixed menu width (`w-60` below) — also used to decide whether it still fits right-aligned to the trigger's left edge. */
const MENU_WIDTH_ESTIMATE = 240
/** Placeholder coords for the aligned-menu first paint — off-screen so nothing flashes before `alignMenuToTrigger` (in a `useLayoutEffect`, so before the browser paints) moves it over the real trigger icon. */
const OFFSCREEN = -9999

/**
 * One-click Fast-Silence button with a duration popover. Hovering, clicking or
 * pressing Enter/Space on the button opens a small popover listing the durations from
 * the `silenceDurations` setting (default 5m … 1w; instance and user configurable); clicking one
 * creates a short-lived exact-match silence for exactly this alert for that
 * duration — no form, no modal. The comment reflects the chosen duration. The
 * menu always opens *below* the button. If `onCreateSilence` is passed, the
 * menu also gains a "Silence…" entry above the durations that opens the full
 * pre-filled form instead — one bell, one hover target, both paths.
 *
 * The panel is a child of the trigger's `Popover` (not portaled to `<body>`), so Tab
 * walks from the trigger straight into it and Escape returns focus — the same shape
 * as `ExtendSilenceMenu`. It is `position: fixed`, so the `overflow-hidden` cards and
 * table cells that host it cannot clip it. Focusing the trigger does not open it:
 * with several cards on a page a keyboard user would otherwise have to tab through
 * every open panel to get past each one.
 *
 * Rendered only when at least one target alert's effective state is `active`
 * (invariant #3), unless `requireActive={false}`. Auth is gated via
 * `useProtectedAction` so `write_protect` mode opens the login modal. After a
 * pick the button shows a transient success/error label so the action is
 * visibly confirmed even before the next poll flips the alert(s) to suppressed.
 */
export function AckButton({
  alerts,
  silences,
  variant = 'detail',
  onOpenChange,
  onCreateSilence,
  requireActive = true,
  subtle = true,
}: AckButtonProps) {
  const { ack, isPending: isAckPending } = useAckAlert()
  const { ackGroup, isPending: isGroupAckPending } = useGroupAckAlert()
  const isPending = isAckPending || isGroupAckPending
  const [feedback, setFeedback] = useState<FeedbackState>('idle')
  const [menuOpen, setMenuOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left?: number; right?: number }>({ top: 0, left: 0 })
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuIconRef = useRef<SVGSVGElement>(null)
  const alignedRef = useRef(false)
  const silenceDurations = useSettingsStore((s) => s.silenceDurations)
  const durationRef = useRef<number>(silenceDurations[0])
  const activeAlerts = alerts.filter((a) => getEffectiveAlertState(a, silences) === 'active')

  useEffect(() => {
    onOpenChange?.(menuOpen || isPending || feedback !== 'idle')
  }, [menuOpen, isPending, feedback, onOpenChange])

  useEffect(() => () => clearTimeout(feedbackTimer.current), [])

  const flash = useCallback((state: FeedbackState) => {
    setFeedback(state)
    clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => setFeedback('idle'), FEEDBACK_MS)
  }, [])

  const action = useCallback(async () => {
    try {
      if (alerts.length > 1) {
        await ackGroup(activeAlerts, durationRef.current)
      } else {
        await Promise.all(activeAlerts.map((a) => ack(a, durationRef.current)))
      }
      flash('done')
    } catch {
      flash('error')
    }
  }, [ack, ackGroup, activeAlerts, alerts.length, flash])

  const { execute } = useProtectedAction(action)

  const position = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()

    if (onCreateSilence) {
      // Real position depends on the menu's rendered width (its first button
      // centers its content), which isn't known until it's in the DOM — park
      // it off-screen and let the layout effect below move it over the
      // trigger icon before paint. Always mirror the "Silence…" button's icon
      // to the right of its label so the menu opens leftward from the
      // trigger — there's always room in that direction (it opens inside the
      // alert card/row itself), unlike rightward where a right-column trigger
      // can run out of viewport.
      alignedRef.current = false
      setCoords({ top: OFFSCREEN, left: OFFSCREEN })
      return
    }

    const overflowsRight = r.left + MENU_WIDTH_ESTIMATE > window.innerWidth
    setCoords(
      overflowsRight
        ? { top: r.bottom + GAP, right: window.innerWidth - r.right }
        : { top: r.bottom + GAP, left: r.left },
    )
  }, [onCreateSilence])

  // Mirrors `menuOpen` for the event handlers below, which must not re-position an open menu: for the
  // "Silence…" variant `position()` parks the menu off-screen until a layout effect aligns it, and that
  // effect only runs when `menuOpen` flips. A hover followed by a focus/click event used to reset the
  // position of an already-open menu and leave it invisible off-screen.
  const menuOpenRef = useRef(false)
  const setOpen = useCallback((open: boolean) => {
    menuOpenRef.current = open // updated synchronously, before any following event handler runs
    setMenuOpen(open)
  }, [])

  // Popover reports every hover-enter as `open = true`, including while already open, so opening is
  // idempotent (see `menuOpenRef`): only the closed → open transition positions the panel.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        if (menuOpenRef.current) return
        position()
      }
      setOpen(next)
    },
    [position, setOpen],
  )

  useEffect(() => {
    if (!menuOpen) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menuOpen, setOpen])

  // Runs before paint once the (off-screen) menu is in the DOM: measures
  // where its own Bell icon actually landed and shifts the whole menu so that
  // icon lands exactly on top of the trigger's Bell icon.
  useLayoutEffect(() => {
    if (!menuOpen || !onCreateSilence || alignedRef.current) return
    const trigger = triggerRef.current
    const icon = menuIconRef.current
    if (!trigger || !icon) return

    const tr = trigger.getBoundingClientRect()
    const ir = icon.getBoundingClientRect()
    // Actual rendered width, not the static MENU_WIDTH_ESTIMATE guess used by
    // the non-aligned path below (that one clamps before the menu exists at
    // all) — clamping against an overestimate here would needlessly push a
    // narrower menu further left/right than the icon alignment calls for.
    const menuWidth = menuRef.current?.getBoundingClientRect().width ?? MENU_WIDTH_ESTIMATE
    const dx = (tr.left + tr.width / 2) - (ir.left + ir.width / 2)
    const dy = (tr.top + tr.height / 2) - (ir.top + ir.height / 2)
    alignedRef.current = true
    setCoords((c) => ({
      top: Math.max(8, c.top + dy),
      left: Math.max(8, Math.min((c.left ?? 0) + dx, window.innerWidth - menuWidth - 8)),
    }))
  }, [menuOpen, onCreateSilence])

  if (requireActive && activeAlerts.length === 0) return null

  const label = feedback === 'done' ? 'Silenced' : feedback === 'error' ? 'Failed' : 'Fast-Silence'
  const silenceLabel = alerts.length > 1 ? `Silence options for ${alerts.length} alerts` : 'Silence options for this alert'

  const icon = (size: string) => {
    if (isPending) return <Loader2 className={cn(size, 'animate-spin')} />
    if (feedback === 'done') return <Check className={size} />
    if (feedback === 'error') return <TriangleAlert className={size} />
    if (variant === 'icon') return <Bell className={size} />
    return variant === 'detail' ? <BellOff className={size} /> : <Check className={size} />
  }

  const pick = (minutes: number) => (e: MouseEvent) => {
    e.stopPropagation()
    durationRef.current = minutes
    setOpen(false)
    execute()
  }

  const Chevron = menuOpen ? ChevronUp : ChevronDown

  return (
    // The anchor stops clicks from reaching a clickable host (the whole AlertCard entry opens the detail panel).
    <span ref={triggerRef} className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <Popover
        open={menuOpen}
        onOpenChange={handleOpenChange}
        // A named group of ordinary buttons, not role="menu": that role promises arrow-key
        // navigation and owned menuitem children, and the options here sit inside a
        // heading/grid wrapper. Claiming it would misannounce the popover.
        role="group"
        label={silenceLabel}
        className="inline-flex"
        panelClassName="fixed z-[100] w-60 rounded-overlay border border-border bg-popover p-2 shadow-xl"
        panelProps={{ style: { top: coords.top, left: coords.left, right: coords.right }, 'data-testid': 'alert-ack-menu' }}
        panelRef={menuRef}
        trigger={({ props }) =>
          variant === 'icon' ? (
            <button
              type="button"
              data-testid="alert-ack-button"
              aria-label={silenceLabel}
              disabled={isPending}
              className={cn(
                'inline-flex h-6 w-6 items-center justify-center rounded-compact transition-colors cursor-pointer disabled:opacity-50',
                feedback === 'error'
                  ? 'text-destructive'
                  : feedback === 'done'
                    ? 'text-success-fg'
                    : subtle
                      ? 'text-muted-foreground/80 hover:bg-accent hover:text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              {...props}
            >
              {icon('h-3.5 w-3.5')}
            </button>
          ) : variant === 'card' ? (
            <button
              type="button"
              data-testid="alert-ack-button"
              aria-label="Fast-Silence this alert"
              disabled={isPending}
              className={cn(
                'inline-flex items-center gap-1 rounded-compact border px-1.5 py-0.5 text-[10px] font-medium cursor-pointer disabled:opacity-50',
                feedback === 'error'
                  ? 'border-destructive/40 bg-card text-destructive'
                  : feedback === 'done'
                    ? 'border-success-edge bg-card text-success-fg'
                    : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              {...props}
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
              aria-label="Fast-Silence this alert"
              disabled={isPending}
              className={
                feedback === 'error'
                  ? 'text-destructive'
                  : feedback === 'done'
                    ? 'text-success-fg'
                    : undefined
              }
              {...props}
            >
              {icon('h-3.5 w-3.5')}
              {label}
              <Chevron className="h-3.5 w-3.5 opacity-60" />
            </Button>
          )
        }
      >
        {onCreateSilence && (
          <button
            type="button"
            data-testid="alert-ack-open-form"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
              onCreateSilence(alerts)
            }}
            className="flex w-full flex-row-reverse items-center gap-2 rounded-surface bg-link/10 px-2.5 py-2 text-left text-[13px] font-semibold text-link transition-colors hover:bg-link/15 cursor-pointer"
          >
            <Bell ref={menuIconRef} className="h-4 w-4 shrink-0" />
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
            <span className="min-w-0 flex-1">
              Silence…
              <span className="block text-[11px] font-medium opacity-70">Open full form</span>
            </span>
          </button>
        )}
        {activeAlerts.length > 0 && (
          <>
            <div className={cn('flex items-center gap-2 px-0.5', onCreateSilence && 'mb-1.5 mt-2')}>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {onCreateSilence && <span className="text-muted-foreground">or </span>}
                {alerts.length > 1 ? `Fast-Silence ${activeAlerts.length} alerts` : 'Fast-Silence'}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="grid grid-cols-4 gap-1">
              {silenceDurations.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  data-testid="alert-ack-option"
                  onClick={pick(minutes)}
                  className="flex items-center justify-center rounded-surface border border-border bg-card px-1 py-1.5 text-xs font-semibold tabular-nums text-foreground transition-colors hover:border-link/40 hover:bg-link/10 hover:text-link cursor-pointer"
                >
                  {formatDurationChoice(minutes)}
                </button>
              ))}
            </div>
          </>
        )}
      </Popover>
    </span>
  )
}
