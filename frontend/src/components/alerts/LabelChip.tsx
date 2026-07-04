import { useRef, useState } from 'react'
import { useUIStore } from '@/store/uiStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { labelColorStyle } from '@/lib/alertUtils'
import type { LabelMatcherOperator } from '@/types'

const OPERATORS: LabelMatcherOperator[] = ['=', '!=', '=~', '!~']

export function LabelChip({ labelKey, value }: { labelKey: string; value: string }) {
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

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onClick={(e) => e.stopPropagation()}
    >
      <span
        ref={chipRef}
        className="max-w-[200px] truncate rounded border px-1.5 py-0.5 text-[10px] font-medium"
        style={labelColorStyle(labelKey, theme)}
        title={`${labelKey}: ${value}`}
      >
        {labelKey}: {value}
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
