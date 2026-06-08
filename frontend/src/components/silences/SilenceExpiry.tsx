import { formatDistanceToNow, format } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import type { Silence } from '@/types'

interface SilenceExpiryProps {
  silence: Silence
  className?: string
}

export function SilenceExpiry({ silence, className }: SilenceExpiryProps) {
  const now = Date.now()
  const endsAt = new Date(silence.endsAt).getTime()
  const remaining = endsAt - now
  const FIFTEEN_MIN = 15 * 60 * 1000

  const { state } = silence.status

  if (state === 'pending') {
    return (
      <span className={cn('text-xs text-slate-400', className)}>
        ⏳ Starts {formatDistanceToNow(new Date(silence.startsAt), { addSuffix: true, locale: enUS })}
      </span>
    )
  }

  if (state === 'active') {
    const isExpiring = remaining <= FIFTEEN_MIN
    return (
      <span className={cn('text-xs', isExpiring ? 'text-yellow-400' : 'text-green-400', className)}>
        {isExpiring
          ? `⚠️ Expires in ${Math.ceil(remaining / 60_000)} min`
          : `Until ${format(new Date(silence.endsAt), 'MMM d, HH:mm', { locale: enUS })}`}
      </span>
    )
  }

  if (state === 'expired') {
    return (
      <span className={cn('text-xs text-muted-foreground', className)}>
        🔕 Expired{' '}
        {formatDistanceToNow(new Date(silence.endsAt), { addSuffix: true, locale: enUS })}
      </span>
    )
  }

  return null
}
