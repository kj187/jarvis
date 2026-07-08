import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshots: dark and light theme side by side for docs comparison.
 * Regenerate: make e2e-screenshot NAME=feature-theme-dark
 *             make e2e-screenshot NAME=feature-theme-light
 */
test('feature-theme-dark', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, manyAlerts)
  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${DIR}/feature-theme-dark.png` })
})

test('feature-theme-light', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, manyAlerts)
  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()
  await page.getByLabel('Switch to light mode').click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${DIR}/feature-theme-light.png` })
})
