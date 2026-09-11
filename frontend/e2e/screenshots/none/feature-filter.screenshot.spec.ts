import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: label-matcher chip filter active in the header.
 * Navigates with URL matchers so the chip bar is pre-populated with a
 * severity=critical filter — showing a subset of alert cards beneath it.
 * Cropped to the toolbar + the one resulting section (not the full page):
 * only one severity survives the filter, so the rest of the page is empty
 * space below the last card row.
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

  const grid = page.getByTestId('card-grid-columns').first()
  const gridBox = (await grid.boundingBox())!
  const viewportWidth = page.viewportSize()!.width

  await page.screenshot({
    path: `${DIR}/feature-filter.png`,
    clip: { x: 0, y: 0, width: viewportWidth, height: gridBox.y + gridBox.height + 16 },
  })
})
