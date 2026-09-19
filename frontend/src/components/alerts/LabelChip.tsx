import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
}: {
  labelKey: string
  value: string
  emphasized?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)
  const chipRef = useRef<HTMLSpanElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addLabelMatcher = useUIStore((s) => s.addLabelMatcher)
  const labelColors = useSettingsStore((s) => s.labelColors)
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

  // Neutral unless this key has a palette color set in Settings → Labels —
  // labels have no automatic color.
  const colorStyle = labelColorStyle(labelKey, labelColors, theme)
  const neutral = !colorStyle

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
          'max-w-[200px] cursor-pointer truncate rounded-compact border px-1.5 py-0.5 text-[10px] font-medium',
          emphasized && 'font-semibold',
          neutral && 'border-border bg-muted text-foreground',
        )}
        style={colorStyle}
      >
        <span className={neutral ? 'text-muted-foreground' : undefined}>{labelKey}:</span> {value}
      </span>

      {open && dropdownPos && (
        <div
          ref={popoverRef}
          className="fixed z-50 w-max max-w-[420px] rounded-surface border border-border bg-popover p-2 shadow-md"
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
                className="rounded-compact px-2 py-0.5 font-mono text-[11px] font-bold text-foreground hover:bg-accent"
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

/**
 * Trailing "+N" chip for a chip row: the labels Settings → Labels hides for
 * this alert. Click opens them in a floating layer — a per-alert peek, never
 * a settings change (see AGENTS.md invariant #19). Deliberately a popover
 * rather than an inline reveal: the card grid balances alerts into columns
 * via CSS `column-count` (AlertCardGrid.tsx), so growing a card's height
 * in place reflows the whole grid and visibly jumps the alert into a
 * different column — a fixed-position layer never changes the card's height.
 * Same portal + viewport-clamp technique as LabelChip's own operator popover.
 */
export function HiddenLabelsToggle({
  hidden,
}: {
  hidden: Array<[string, string]>
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // The popover's size isn't known until it's rendered — nudge it back onto
  // the viewport right after paint (same technique as LabelChip's own
  // dropdown and Settings → Labels' color swatch popover).
  useLayoutEffect(() => {
    if (!open) return
    const el = popoverRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const overflowRight = rect.right - (window.innerWidth - 8)
    const overflowBottom = rect.bottom - (window.innerHeight - 8)
    if (overflowRight > 0 || overflowBottom > 0) {
      setPos((p) => (p ? {
        top: overflowBottom > 0 ? Math.max(8, p.top - overflowBottom) : p.top,
        left: overflowRight > 0 ? Math.max(8, p.left - overflowRight) : p.left,
      } : p))
    }
  }, [open])

  if (hidden.length === 0) return null

  function toggleOpen(e: React.MouseEvent) {
    e.stopPropagation()
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.left })
    }
    setOpen((o) => !o)
  }

  const noun = `hidden label${hidden.length === 1 ? '' : 's'}`
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        aria-label={`${hidden.length} ${noun}`}
        aria-expanded={open}
        className="inline-flex shrink-0 cursor-pointer items-center rounded-compact border border-dashed border-border px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground transition-colors hover:text-foreground"
        title={open ? `Collapse ${noun}` : `Show ${hidden.length} ${noun}: ${hidden.map(([k]) => k).join(', ')}`}
      >
        +{hidden.length}
      </button>
      {open && pos && createPortal(
        <div
          ref={popoverRef}
          data-testid="hidden-labels-popover"
          className="fixed z-50 flex max-w-[280px] flex-wrap gap-1 rounded-surface border border-border bg-popover p-2 shadow-lg"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          {hidden.map(([key, value]) => (
            <LabelChip key={key} labelKey={key} value={value} />
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
