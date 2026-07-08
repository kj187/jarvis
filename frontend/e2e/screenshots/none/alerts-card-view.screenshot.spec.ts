import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: alerts card view, populated with alerts grouped by severity.
 * Uses fireWithHeatmapHistory so each card's firing sparkline isn't a
 * suspiciously empty row (it freezes the clock itself — see that helper's
 * docstring). Regenerate individually: make e2e-screenshot NAME=alerts-card-view
 */
test('alerts-card-view', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, manyAlerts)

  await page.goto('/?state=active&viewMode=card')
  
  // Wait for cards to render
  await expect(page.getByTestId('alert-card').first()).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/alerts-card-view.png`, fullPage: true })
})
