import { useState } from 'react'
import { cn } from '@/lib/utils'

export function TruncatableChip({
  children,
  className,
  style,
}: {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <span
      className={cn(className, 'cursor-pointer', expanded ? 'break-all' : 'max-w-[280px] truncate')}
      style={style}
      onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}
    >
      {children}
    </span>
  )
}
