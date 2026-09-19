import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { AlarmClockPlus, Check, Loader2, TriangleAlert } from 'lucide-react'
import { Popover } from '@/components/ui/popover'
import { useExtendSilences } from '@/hooks/useSilences'
import { useProtectedAction } from '@/hooks/useProtectedAction'
import { formatDurationChoice } from '@/lib/silenceDurations'
import { useSettingsStore } from '@/store/useSettingsStore'
import { cn } from '@/lib/utils'
import type { Silence } from '@/types'

interface ExtendSilenceMenuProps {
  /** Silences to extend together. Expired ones are ignored — Alertmanager cannot extend those in place. */
  silences: Silence[]
  /** Records the extension on this alert's timeline (detail panel / alert rows). Omit on the Silences page. */
  fingerprint?: string
  /** `icon` = bare icon button for an action rail, `button` = bordered icon + "Extend" label. */
  variant?: 'icon' | 'button'
  /** `warning` tints the trigger for a silence that is about to run out; the menu and its behaviour are identical. */
  tone?: 'default' | 'warning'
  className?: string
}

type FeedbackState = 'idle' | 'done' | 'error'

const FEEDBACK_MS = 2500
/** Vertical gap between the trigger and the menu. */
const GAP = 6
/** Fixed menu width (`w-56` below) — decides whether it still fits left-aligned to the trigger. */
const MENU_WIDTH = 224
/** Buttons per row in the menu. */
const COLUMNS = 4
/** Rough menu height for `rows` rows of durations (header + rows) — decides whether it opens above the trigger instead of below. */
const menuHeightEstimate = (rows: number) => 44 + rows * 32

interface Coords {
  top?: number
  bottom?: number
  left?: number
  right?: number
}

/**
 * One-click "Extend by…" menu for active/pending silences: hover (or click /
 * Enter) the icon, pick a duration from the `silenceDurations` setting, and the
 * silence's end moves out by that much — no form. The duration is added to
 * the current end time, so it can only ever lengthen a silence. Several
 * silences (a group) are extended together. Auth is gated via
 * `useProtectedAction` so `write_protect` mode opens the login modal first.
 * Renders nothing when there is no active or pending silence to extend.
 *
 * The panel is `position: fixed` (not absolutely positioned) so the
 * `overflow-hidden` silence cards and table cells that host it cannot clip it.
 */
export function ExtendSilenceMenu({ silences, fingerprint, variant = 'icon', tone = 'default', className }: ExtendSilenceMenuProps) {
  const extendable = silences.filter((s) => s.status.state !== 'expired')
  const { extend, isPending } = useExtendSilences()
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<Coords>({})
  const [feedback, setFeedback] = useState<FeedbackState>('idle')
  const anchorRef = useRef<HTMLSpanElement>(null)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const silenceDurations = useSettingsStore((s) => s.silenceDurations)
  const minutesRef = useRef<number>(silenceDurations[0])

  useEffect(() => () => clearTimeout(feedbackTimer.current), [])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const flash = useCallback((state: FeedbackState) => {
    setFeedback(state)
    clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => setFeedback('idle'), FEEDBACK_MS)
  }, [])

  const action = useCallback(async () => {
    try {
      await extend(extendable, minutesRef.current, fingerprint)
      flash('done')
    } catch {
      flash('error')
    }
  }, [extend, extendable, fingerprint, flash])

  const { execute } = useProtectedAction(action)

  const handleOpenChange = useCallback((next: boolean) => {
    if (next && anchorRef.current) {
      const r = anchorRef.current.getBoundingClientRect()
      const horizontal = r.left + MENU_WIDTH > window.innerWidth
        ? { right: window.innerWidth - r.right }
        : { left: r.left }
      const vertical = r.bottom + GAP + menuHeightEstimate(Math.ceil(silenceDurations.length / COLUMNS)) > window.innerHeight
        ? { bottom: window.innerHeight - r.top + GAP }
        : { top: r.bottom + GAP }
      setCoords({ ...horizontal, ...vertical })
    }
    setOpen(next)
  }, [silenceDurations.length])

  if (extendable.length === 0) return null

  const pick = (minutes: number) => (e: MouseEvent) => {
    e.stopPropagation()
    minutesRef.current = minutes
    setOpen(false)
    execute()
  }

  const label = extendable.length > 1 ? `Extend ${extendable.length} silences` : 'Extend silence'
  const Icon = isPending ? Loader2 : feedback === 'done' ? Check : feedback === 'error' ? TriangleAlert : AlarmClockPlus
  const iconClass = cn(variant === 'icon' ? 'h-3.5 w-3.5' : 'h-3 w-3', isPending && 'animate-spin')

  return (
    // The anchor stops clicks from reaching a clickable host (e.g. the whole SilenceCard opens the editor).
    <span ref={anchorRef} className={cn('inline-flex', className)} onClick={(e) => e.stopPropagation()}>
      <Popover
        open={open}
        onOpenChange={handleOpenChange}
        role="menu"
        label={label}
        className="inline-flex"
        panelClassName="fixed z-[100] w-56 rounded-overlay border border-border bg-popover p-2 shadow-xl"
        panelProps={{ style: coords, 'data-testid': 'extend-silence-menu' }}
        trigger={({ props }) => (
          <button
            type="button"
            data-testid="extend-silence-button"
            aria-haspopup="menu"
            aria-label={label}
            title={label}
            disabled={isPending}
            className={cn(
              'inline-flex items-center justify-center gap-1 rounded-compact transition-colors cursor-pointer disabled:opacity-50',
              variant === 'icon' ? 'h-6 w-6' : 'border px-2 py-0.5 text-xs',
              feedback === 'error'
                ? 'border-destructive/40 text-destructive'
                : feedback === 'done'
                  ? 'border-success-edge text-success-fg'
                  : tone === 'warning'
                    ? 'border-warning-edge text-warning-fg hover:bg-warning-soft'
                    : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
              variant === 'icon' && 'border-0',
            )}
            {...props}
          >
            <Icon className={iconClass} />
            {variant === 'button' && <span>{feedback === 'done' ? 'Extended' : feedback === 'error' ? 'Failed' : 'Extend'}</span>}
          </button>
        )}
      >
        <div className="mb-1.5 flex items-center gap-2 px-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {extendable.length > 1 ? `Extend ${extendable.length} silences by` : 'Extend by'}
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="grid grid-cols-4 gap-1">
          {silenceDurations.map((minutes) => (
            <button
              key={minutes}
              type="button"
              role="menuitem"
              data-testid="extend-silence-option"
              onClick={pick(minutes)}
              className="flex items-center justify-center rounded-surface border border-border bg-card px-1 py-1.5 text-xs font-semibold tabular-nums text-foreground transition-colors hover:border-link/40 hover:bg-link/10 hover:text-link cursor-pointer"
            >
              +{formatDurationChoice(minutes)}
            </button>
          ))}
        </div>
      </Popover>
    </span>
  )
}
