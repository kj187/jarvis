import { format } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { silenceTiming, tzAbbr } from '@/lib/alertUtils'
import { URGENCY_FILL_CLASS, URGENCY_TEXT_CLASS, silenceRemainingText } from './silenceDisplay'
import type { Silence } from '@/types'

const CAP_FMT = 'MMM d, HH:mm'

function cap(iso: string): string {
  return format(new Date(iso), CAP_FMT, { locale: enUS })
}

/**
 * "Time zone" of a silence card (variant B): a bar showing how far the mute
 * window (`startsAt`→`endsAt`) has run, capped by the creation and expiry
 * timestamps, with the remaining-time label left-aligned underneath.
 */
export function SilenceLifetimeBar({ silence }: { silence: Silence }) {
  const { pct, urgency } = silenceTiming(silence)

  return (
    <div className="border-t border-border/60 bg-muted/30 px-3.5 py-2.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-border">
        <div className={URGENCY_FILL_CLASS[urgency]} style={{ width: `${pct}%`, height: '100%' }} />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10.5px] text-muted-foreground/70">
        <span>created {cap(silence.updatedAt)} {tzAbbr}</span>
        <span>{cap(silence.endsAt)} {tzAbbr}</span>
      </div>
      <div className={`mt-1 text-xs font-medium ${URGENCY_TEXT_CLASS[urgency]}`}>
        {silenceRemainingText(silence)}
      </div>
    </div>
  )
}
