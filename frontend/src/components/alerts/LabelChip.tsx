import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { labelColorStyle } from '@/lib/alertUtils'
import type { LabelMatcherOperator } from '@/types'

const OPERATORS: LabelMatcherOperator[] = ['=', '!=', '=~', '!~']

export function LabelChip({
  labelKey,
  value,
  emphasized = false,
  muted = false,
}: {
  labelKey: string
  value: string
  emphasized?: boolean
  /** Neutral styling — no per-key hue. For strips of context labels that are
      identical across a group and shouldn't compete with the real signal. */
  muted?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)
  const chipRef = useRef<HTMLSpanElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addLabelMatcher = useUIStore((s) => s.addLabelMatcher)
  const theme = useSettingsStore((s) => s.theme)

  const show = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    if (chipRef.current) {
      const rect = chipRef.current.getBoundingClientRect()
      setDropdownPos({ top: rect.bottom + 4, left: rect.left })
    }
    setOpen(true)
  }
  const hide = () => {
    hideTimer.current = setTimeout(() => setOpen(false), 120)
  }

  // The popover sizes to its content (`w-max`) so a short value stays on one
  // line instead of being forced to wrap in a fixed-width box — only a value
  // past the `max-w` cap below wraps at all. That content width isn't known
  // until it's rendered, so nudge the left edge back onto the viewport here,
  // before paint (no visible jump).
  useLayoutEffect(() => {
    if (!open) return
    const el = popoverRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const overflow = rect.right - (window.innerWidth - 8)
    if (overflow > 0) {
      setDropdownPos((pos) => (pos ? { ...pos, left: Math.max(8, pos.left - overflow) } : pos))
    }
  }, [open])

  const apply = (op: LabelMatcherOperator, e: React.MouseEvent) => {
    e.stopPropagation()
    addLabelMatcher({ name: labelKey, operator: op, value })
    setOpen(false)
  }

  // `emphasized` keeps its per-key hue (a distinguishing label is easier to
  // tell apart with colour); only `muted` context strips drop it.
  const neutral = muted

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onClick={(e) => e.stopPropagation()}
    >
      <span
        ref={chipRef}
        className={cn(
          // One size for every chip — `emphasized` only adds weight, never a
          // bigger box, so a group of chips reads as one consistent row.
          // `cursor-pointer` is set here explicitly (not left to inherit from
          // a clickable ancestor) — the common-labels strip above a group has
          // no clickable ancestor, so without this the chip fell back to the
          // browser's default text cursor.
          'max-w-[200px] cursor-pointer truncate rounded border px-1.5 py-0.5 text-[10px] font-medium',
          emphasized && 'font-semibold',
          neutral && 'border-border bg-muted text-foreground',
        )}
        style={neutral ? undefined : labelColorStyle(labelKey, theme)}
      >
        <span className={neutral ? 'text-muted-foreground' : undefined}>{labelKey}:</span> {value}
      </span>

      {open && dropdownPos && (
        <div
          ref={popoverRef}
          className="fixed z-50 w-max max-w-[420px] rounded-lg border border-border bg-popover p-2 shadow-md"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          {/* Full, untruncated value — this is what a hover is for when the
              chip itself is cut off with an ellipsis. Prefers one line
              (`w-max`); only wraps past the 420px cap for pathological values. */}
          <div className="break-words text-[11px] leading-snug text-foreground">
            <span className="text-muted-foreground">{labelKey}:</span> {value}
          </div>
          <div className="mt-1.5 flex items-center gap-px border-t border-border pt-1.5">
            {OPERATORS.map((op) => (
              <button
                key={op}
                onClick={(e) => apply(op, e)}
                className="rounded px-2 py-0.5 font-mono text-[11px] font-bold text-foreground hover:bg-accent"
              >
                {op}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
