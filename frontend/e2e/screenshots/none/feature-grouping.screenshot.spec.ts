import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: the "Grouped" toolbar control's popover open — on/off toggle
 * plus the searchable, scrollable "group by which label" picker that used to
 * live only in Settings.
 * Cropped to just the button + its open popover (not the full page): the
 * panel is absolutely positioned, so it doesn't contribute to its static
 * wrapper's layout box — a plain locator screenshot of the wrapper would
 * clip to the button alone. Union the two elements' boxes instead.
 * Regenerate: make e2e-screenshot NAME=feature-grouping
 */
test('feature-grouping', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, manyAlerts)

  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()

  const button = page.getByTestId('grouping-control-button')
  await button.click()
  const panel = page.getByTestId('grouping-panel')
  await expect(panel).toBeVisible()
  await page.waitForTimeout(150)

  const buttonBox = (await button.boundingBox())!
  const panelBox = (await panel.boundingBox())!
  const pad = 10
  const x = Math.min(buttonBox.x, panelBox.x) - pad
  const y = buttonBox.y - pad
  const right = Math.max(buttonBox.x + buttonBox.width, panelBox.x + panelBox.width) + pad
  const bottom = panelBox.y + panelBox.height + pad

  await page.screenshot({
    path: `${DIR}/feature-grouping.png`,
    clip: { x, y, width: right - x, height: bottom - y },
  })
})
