import { useRef, useState } from 'react'
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
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addLabelMatcher = useUIStore((s) => s.addLabelMatcher)
  const theme = useSettingsStore((s) => s.theme)

  const show = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    if (chipRef.current) {
      const rect = chipRef.current.getBoundingClientRect()
      setDropdownPos({ top: rect.bottom + 2, left: rect.left })
    }
    setOpen(true)
  }
  const hide = () => {
    hideTimer.current = setTimeout(() => setOpen(false), 120)
  }

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
          'truncate rounded border font-medium',
          emphasized ? 'max-w-[340px] px-2 py-0.5 text-xs font-semibold' : 'max-w-[220px] px-1.5 py-0.5 text-[10px]',
          neutral && 'border-border bg-muted text-foreground',
        )}
        style={neutral ? undefined : labelColorStyle(labelKey, theme)}
        title={`${labelKey}: ${value}`}
      >
        <span className={neutral ? 'text-muted-foreground' : undefined}>{labelKey}:</span> {value}
      </span>

      {open && dropdownPos && (
        <div
          className="fixed z-50 flex items-center gap-px rounded border border-border bg-popover p-0.5 shadow-md"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
          onMouseEnter={show}
          onMouseLeave={hide}
        >
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
      )}
    </div>
  )
}
