import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { ensureInternalAdmin } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: the login modal (internal mode). Requires the admin to already
 * exist so the app shows the dashboard with a login button.
 *   make e2e-screenshot NAME=login-modal MODE=internal
 */
test('login-modal', async ({ page, am, jarvis }) => {
  await ensureInternalAdmin(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, manyAlerts)

  await page.goto('/?state=active')
  await page.getByTestId('login-button').click()

  const dialog = page.getByRole('dialog', { name: 'Login' })
  await expect(dialog).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/auth-login-internal.png` })
})
