import { silenceTiming } from '@/lib/alertUtils'
import { URGENCY_TEXT_CLASS, silenceRemainingText } from './silenceDisplay'
import { cn } from '@/lib/utils'
import type { Silence } from '@/types'

/** Compact, colour-coded remaining-time label (dense list row). */
export function SilenceRemaining({ silence, className }: { silence: Silence; className?: string }) {
  const { urgency } = silenceTiming(silence)
  return (
    <span className={cn('font-medium', URGENCY_TEXT_CLASS[urgency], className)}>
      {silenceRemainingText(silence)}
    </span>
  )
}
