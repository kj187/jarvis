import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { loginOIDC } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: the dashboard after a successful OIDC login (admin via SSO).
 * Shows the authenticated header (user menu) over a populated dashboard.
 *   make e2e-screenshot NAME=oidc-authenticated MODE=oidc
 */
test('oidc-authenticated', async ({ page, am, jarvis }) => {
  await loginOIDC(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, manyAlerts)

  await page.goto('/?state=active')
  await expect(page.getByTestId('user-menu')).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/oidc-authenticated.png`, fullPage: true })
})
