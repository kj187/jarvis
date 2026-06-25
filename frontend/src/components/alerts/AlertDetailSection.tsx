import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface AlertDetailSectionProps {
  title: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  headerRight?: ReactNode
  testId?: string
}

export function AlertDetailSection({
  title,
  children,
  defaultOpen = true,
  headerRight,
  testId,
}: AlertDetailSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div data-testid={testId} className="border-b border-border py-4 px-5">
      <button
        className="flex w-full items-center justify-between text-sm font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-1.5">{title}</span>
        <div className="flex items-center gap-2">
          {headerRight && (
            <span onClick={(e) => e.stopPropagation()}>{headerRight}</span>
          )}
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  )
}
