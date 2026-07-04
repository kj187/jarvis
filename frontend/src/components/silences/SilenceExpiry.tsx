import { format } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { cn, formatDuration } from '@/lib/utils'
import { tzAbbr } from '@/lib/alertUtils'
import type { Silence } from '@/types'

interface SilenceExpiryProps {
  silence: Silence
  className?: string
}

const DATE_FMT = 'MMM d, yyyy HH:mm'

function ExactDate({ value }: { value: string }) {
  return (
    <span className="text-xs font-medium text-foreground">
      {format(new Date(value), DATE_FMT, { locale: enUS })} {tzAbbr}
    </span>
  )
}

export function SilenceExpiry({ silence, className }: SilenceExpiryProps) {
  const now = Date.now()
  const startsAt = new Date(silence.startsAt).getTime()
  const endsAt = new Date(silence.endsAt).getTime()
  const remaining = endsAt - now
  const FIFTEEN_MIN = 15 * 60 * 1000

  const { state } = silence.status

  if (state === 'pending') {
    return (
      <div className={cn('flex flex-col gap-0.5', className)}>
        <ExactDate value={silence.startsAt} />
        <span className="text-xs text-slate-400">
          ⏳ Starts in {formatDuration(startsAt - now)}
        </span>
      </div>
    )
  }

  if (state === 'active') {
    const isExpiring = remaining <= FIFTEEN_MIN
    return (
      <div className={cn('flex flex-col gap-0.5', className)}>
        <ExactDate value={silence.endsAt} />
        <span className={cn('text-xs', isExpiring ? 'text-yellow-400' : 'text-green-400')}>
          {isExpiring ? '⚠️ ' : ''}In {formatDuration(remaining)}
        </span>
      </div>
    )
  }

  if (state === 'expired') {
    return (
      <div className={cn('flex flex-col gap-0.5', className)}>
        <ExactDate value={silence.endsAt} />
        <span className="text-xs text-muted-foreground">
          🔕 Expired {formatDuration(now - endsAt)} ago
        </span>
      </div>
    )
  }

  return null
}
