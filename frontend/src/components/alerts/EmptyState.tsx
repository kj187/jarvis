import { Inbox } from 'lucide-react'

export function EmptyState() {
  return (
    <div className="flex items-center justify-center pt-72 pb-24 select-none" aria-label="No alerts">
      <Inbox
        className="h-48 w-48 text-muted-foreground opacity-40"
        strokeWidth={1.25}
        aria-hidden
      />
    </div>
  )
}
