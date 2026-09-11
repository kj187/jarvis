import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { ensureInternalAdmin } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: the header user-menu open while signed out — Settings and the
 * theme toggle are still there, plus a Login entry (a provider is configured
 * but no session exists). Pairs with the "signed in" case, which reuses
 * auth-user-menu.png (internal mode, authenticated as admin) rather than
 * duplicating a near-identical shot — see docs/features.md "User Settings".
 * Runs in internal mode specifically because mode "none" has no login
 * concept at all (no Login entry ever appears there).
 * Cropped to trigger + popover, same technique as feature-grouping.
 * Regenerate: make e2e-screenshot NAME=feature-user-menu MODE=internal
 */
test('feature-user-menu', async ({ page, am, jarvis }) => {
  await ensureInternalAdmin(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, manyAlerts)

  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()

  const button = page.getByTestId('user-menu')
  await button.hover()
  const panel = page.getByTestId('user-menu-panel')
  await expect(panel).toBeVisible()
  await expect(page.getByTestId('login-button')).toBeVisible()
  await page.waitForTimeout(150)

  const buttonBox = (await button.boundingBox())!
  const panelBox = (await panel.boundingBox())!
  const pad = 10
  const x = Math.min(buttonBox.x, panelBox.x) - pad
  const y = buttonBox.y - pad
  const right = Math.max(buttonBox.x + buttonBox.width, panelBox.x + panelBox.width) + pad
  const bottom = panelBox.y + panelBox.height + pad

  await page.screenshot({
    path: `${DIR}/feature-user-menu.png`,
    clip: { x, y, width: right - x, height: bottom - y },
  })
})
