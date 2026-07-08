import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: label-matcher chip filter active in the header.
 * Navigates with URL matchers so the chip bar is pre-populated with a
 * severity=critical filter — showing a subset of alert cards beneath it.
 * Regenerate: make e2e-screenshot NAME=feature-filter
 */
test('feature-filter', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, manyAlerts)

  const matchers = JSON.stringify([
    { name: 'severity', operator: '=', value: 'critical' },
  ])
  await page.goto(`/?state=active&matchers=${encodeURIComponent(matchers)}`)
  await expect(page.getByTestId('alert-card').first()).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/feature-filter.png`, fullPage: true })
})
