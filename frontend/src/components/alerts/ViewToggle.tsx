import { LayoutGrid, List } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ViewMode } from '@/store/uiStore'
import { cn } from '@/lib/utils'

interface ViewToggleProps {
  value: ViewMode
  onChange: (mode: ViewMode) => void
}

export function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <div className="flex items-center rounded-md border border-border overflow-hidden">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onChange('card')}
        title="Card View"
        className={cn(
          'rounded-none h-7 w-7',
          value === 'card' && 'bg-accent',
        )}
        aria-pressed={value === 'card'}
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onChange('list')}
        title="List View"
        className={cn(
          'rounded-none h-7 w-7',
          value === 'list' && 'bg-accent',
        )}
        aria-pressed={value === 'list'}
      >
        <List className="h-4 w-4" />
      </Button>
    </div>
  )
}
