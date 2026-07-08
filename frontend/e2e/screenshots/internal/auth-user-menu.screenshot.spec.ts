import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { ensureInternalAdmin, loginInternal } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: user-menu dropdown open, showing Admin and Logout actions.
 * Regenerate: make e2e-screenshot NAME=auth-user-menu MODE=internal
 */
test('auth-user-menu', async ({ page, am, jarvis }) => {
  await ensureInternalAdmin(page)
  await loginInternal(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, manyAlerts)

  await page.goto('/?state=active')
  await expect(page.getByTestId('user-menu')).toBeVisible()

  await page.getByTestId('user-menu').click()
  await expect(page.getByText('Logout')).toBeVisible()
  // Hover inside the dropdown to prevent onMouseLeave from closing it
  await page.getByText('Logout').hover()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/auth-user-menu.png` })
})
