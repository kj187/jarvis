import type { Page } from '@playwright/test'
import { manyAlerts } from '../fixtures/alerts'
import type { AlertInput } from './alertmanager'

/**
 * `manyAlerts` as posted by `am.fire()` shows "Expires in over 73 years" on
 * every card: `fireWithHeatmapHistory` freezes the *browser* clock to "now"
 * and only then fires alerts, so Alertmanager's own unfrozen clock always
 * assigns `startsAt` a little after that frozen instant. AlertCard reads
 * `startsAt > now` as "not started yet" and shows the `endsAt` countdown
 * instead of "X ago" — `am.fire()` defaults `endsAt` to a placeholder far in
 * the future so alerts never auto-resolve mid-test, which is what actually
 * surfaces here. Giving each alert an explicit past `startsAt` (computed
 * before the freeze happens, so it can never land on the wrong side of it)
 * sidesteps the race and produces the realistic "X ago" these two screenshots
 * are supposed to show. `cluster: 'e2e'` is also replaced — half of
 * `manyAlerts` carries it, and "e2e" reads as a test environment rather than
 * the multi-region deployment the rest of the fixture depicts.
 *
 * Shared by the card-view and home-tour screenshot specs: `manyAlerts` itself (used by ~30 other specs) and
 * `fireWithHeatmapHistory`/`am.fire()` (used by every other screenshot) are
 * untouched.
 */
export const FIRING_MINUTES_AGO = [134, 18, 47, 5, 210, 92, 8, 21, 63, 15, 191, 39, 26, 4]

export const screenshotAlerts: AlertInput[] = manyAlerts.map((alert, i) => ({
  ...alert,
  labels:
    alert.labels.cluster === 'e2e' ? { ...alert.labels, cluster: 'on-prem' } : alert.labels,
  startsAt: new Date(
    Date.now() - FIRING_MINUTES_AGO[i % FIRING_MINUTES_AGO.length] * 60_000,
  ).toISOString(),
}))

/** Hides the `test_suite` housekeeping label (display-only — invariant #19)
 *  without touching how the alert was fired or how cleanup finds it. `order`
 *  must be given alongside `hidden` — the pre-v2 settings migration path
 *  spreads a persisted `labelDisplay` straight into resolved settings without
 *  validating its shape, so an `order`-less object silently loses that field. */
export async function hideTestSuiteLabel(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'jarvis-user-settings',
      JSON.stringify({
        state: { labelDisplay: { order: [], hidden: ['test_suite'] } },
        version: 0,
      }),
    )
  })
}
