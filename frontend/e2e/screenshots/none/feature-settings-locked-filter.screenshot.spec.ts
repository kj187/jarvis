import { test, expect, freezeClock, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: header with a locked default filter chip (severity=critical) set via Settings.
 * Regenerate: make e2e-screenshot NAME=feature-settings-locked-filter
 */
test('feature-settings-locked-filter', async ({ page, am, jarvis }) => {
  await page.addInitScript(() => {
    const settings = {
      theme: 'dark',
      timeFormat: 'relative',
      defaultViewMode: 'card',
      defaultFilters: [{ name: 'severity', operator: '=', value: 'critical' }],
      resolvedPageSize: 25,
      defaultSilenceDurationMinutes: 60,
      defaultCreatorName: '',
      pollIntervalSeconds: 15,
      claimAnimationEnabled: true,
    }
    localStorage.setItem('jarvis-user-settings', JSON.stringify({ state: settings, version: 0 }))
  })
  await freezeClock(page)
  await dismissNoAuthNotice(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.goto('/?state=active')
  await expect(page.getByTitle(/Default filter set in Settings/)).toBeVisible()
  await expect(
    page.getByTestId('alert-card').first().or(page.getByLabel('No alerts')),
  ).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/feature-settings-locked-filter.png`, fullPage: true })
})
