import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
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
      claimAnimationEnabled: true,
    }
    localStorage.setItem('jarvis-user-settings', JSON.stringify({ state: settings, version: 0 }))
  })
  await dismissNoAuthNotice(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, manyAlerts)

  await page.goto('/?state=active')
  await expect(page.getByTitle(/Default filter set in Settings/)).toBeVisible()
  await expect(
    page.getByTestId('alert-card').first().or(page.getByLabel('No alerts')),
  ).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/feature-settings-locked-filter.png`, fullPage: true })
})
