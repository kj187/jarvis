import { silenceTiming, type SilenceUrgency } from '@/lib/alertUtils'
import { formatDuration } from '@/lib/utils'
import type { Silence } from '@/types'

/** Text colour per urgency — same shades the silence views have always used. */
export const URGENCY_TEXT_CLASS: Record<SilenceUrgency, string> = {
  pending: 'text-neutral-fg',
  ok: 'text-success-fg',
  soon: 'text-warning-fg',
  expired: 'text-muted-foreground',
}

/** Bar-fill / stripe colour per urgency. */
export const URGENCY_FILL_CLASS: Record<SilenceUrgency, string> = {
  pending: 'bg-neutral-solid',
  ok: 'bg-success-solid',
  soon: 'bg-warning-solid',
  expired: 'bg-neutral-solid',
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
