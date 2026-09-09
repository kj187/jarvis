import { cn, formatDuration } from '@/lib/utils'
import { ExactDate } from './SilenceExpiry'
import type { Silence } from '@/types'

interface SilenceCreatedProps {
  silence: Silence
  className?: string
}

/**
 * When the silence was created (Alertmanager's `updatedAt` — also its
 * last-edit time, since editing a silence in AM rewrites this field).
 * Rendered next to `SilenceExpiry` in the card and list views.
 */
export function SilenceCreated({ silence, className }: SilenceCreatedProps) {
  const ago = Date.now() - new Date(silence.updatedAt).getTime()

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <ExactDate value={silence.updatedAt} />
      <span className="text-xs text-muted-foreground">{formatDuration(ago)} ago</span>
    </div>
  )
}
