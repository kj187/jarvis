import { silenceTiming, type SilenceUrgency } from '@/lib/alertUtils'
import { formatDuration } from '@/lib/utils'
import type { Silence } from '@/types'

/** Text colour per urgency — same shades the silence views have always used. */
export const URGENCY_TEXT_CLASS: Record<SilenceUrgency, string> = {
  pending: 'text-slate-400',
  ok: 'text-green-400',
  soon: 'text-yellow-400',
  expired: 'text-muted-foreground',
}

/** Bar-fill / stripe colour per urgency. */
export const URGENCY_FILL_CLASS: Record<SilenceUrgency, string> = {
  pending: 'bg-slate-400',
  ok: 'bg-green-500',
  soon: 'bg-yellow-500',
  expired: 'bg-slate-500',
}

/** `alertname=`, `env!~`, … — the Alertmanager matcher operator. */
export function matcherOperator(isRegex: boolean, isEqual: boolean): string {
  if (isRegex) return isEqual ? '=~' : '!~'
  return isEqual ? '=' : '!='
}

/**
 * Human remaining-time phrase for a silence, consistent across the card
 * lifetime bar and the dense list row. `soon` keeps a ⚠️ so an
 * about-to-expire silence still reads at a glance without the bar.
 */
export function silenceRemainingText(silence: Silence): string {
  const { urgency, remainingMs } = silenceTiming(silence)
  if (urgency === 'pending') return `Starts in ${formatDuration(remainingMs)}`
  if (urgency === 'expired') return `Expired ${formatDuration(-remainingMs)} ago`
  if (remainingMs <= 0) return `⚠️ Overdue ${formatDuration(-remainingMs)}`
  if (urgency === 'soon') return `⚠️ ${formatDuration(remainingMs)} left`
  return `${formatDuration(remainingMs)} left`
}
