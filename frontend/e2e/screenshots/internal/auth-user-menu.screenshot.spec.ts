import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { ensureInternalAdmin, loginInternal } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: user-menu dropdown open, showing Admin and Logout actions.
 * Cropped to the trigger + its popover (union-of-boxes technique, same as
 * feature-user-menu / feature-grouping) instead of the full page.
 * Regenerate: make e2e-screenshot NAME=auth-user-menu MODE=internal
 */
test('auth-user-menu', async ({ page, am, jarvis }) => {
  await ensureInternalAdmin(page)
  await loginInternal(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, manyAlerts)

  await page.goto('/?state=active')
  const button = page.getByTestId('user-menu')
  await expect(button).toBeVisible()

  await button.click()
  await expect(page.getByText('Logout')).toBeVisible()
  // Hover inside the dropdown to prevent onMouseLeave from closing it
  await page.getByText('Logout').hover()
  const panel = page.getByTestId('user-menu-panel')
  await expect(panel).toBeVisible()
  await page.waitForTimeout(300)

  const buttonBox = (await button.boundingBox())!
  const panelBox = (await panel.boundingBox())!
  const pad = 10
  const x = Math.min(buttonBox.x, panelBox.x) - pad
  const y = buttonBox.y - pad
  const right = Math.max(buttonBox.x + buttonBox.width, panelBox.x + panelBox.width) + pad
  const bottom = panelBox.y + panelBox.height + pad

  await page.screenshot({
    path: `${DIR}/auth-user-menu.png`,
    clip: { x, y, width: right - x, height: bottom - y },
  })
})
