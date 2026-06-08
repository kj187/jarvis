import React, { useRef, useState } from 'react'
import { useUIStore } from '@/store/uiStore'
import type { LabelMatcherOperator } from '@/types'

export const HIDDEN_LABEL_KEYS = new Set(['alertname', 'severity', 'receiver', '@receiver'])

const OPERATORS: LabelMatcherOperator[] = ['=', '!=', '=~', '!~']

export function labelColorStyle(key: string): React.CSSProperties {
  let h = 5381
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0
  const hue = h % 360
  return {
    backgroundColor: `hsl(${hue} 40% 16%)`,
    color: `hsl(${hue} 70% 72%)`,
    borderColor: `hsl(${hue} 35% 30%)`,
  }
}

export function LabelChip({ labelKey, value }: { labelKey: string; value: string }) {
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)
  const chipRef = useRef<HTMLSpanElement | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addLabelMatcher = useUIStore((s) => s.addLabelMatcher)

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
        style={labelColorStyle(labelKey)}
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
