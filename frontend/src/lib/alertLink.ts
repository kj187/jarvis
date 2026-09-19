import { makeAlertSelectionKeyForAlert } from '@/lib/alertSelection'
import type { EnrichedAlert } from '@/types'

/**
 * A link that opens `alert` in the detail panel for whoever receives it.
 *
 * Deliberately minimal: only the view state that decides whether the alert is found (`state`) and
 * the selection (`alert`). The sender's search, label filters and open tab are left out — they are
 * irrelevant to the recipient, would hide nothing (a selected alert opens regardless of filters)
 * and only make the link long. A resolved alert needs `state=resolved`, because the history is
 * only queried in that view.
 */
export function buildAlertShareUrl(alert: EnrichedAlert, base: Pick<Location, 'origin' | 'pathname'>): string {
  const params = new URLSearchParams()
  params.set('state', alert.status.state === 'resolved' ? 'resolved' : 'active')
  params.set('alert', makeAlertSelectionKeyForAlert(alert))
  return `${base.origin}${base.pathname}?${params.toString()}`
}
