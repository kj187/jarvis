import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { ensureInternalAdmin } from '../../support/auth'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: the login modal (internal mode). Requires the admin to already
 * exist so the app shows the dashboard with a login button.
 *   make e2e-screenshot NAME=login-modal MODE=internal
 */
test('login-modal', async ({ page, am, jarvis }) => {
  await ensureInternalAdmin(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.goto('/?state=active')
  await page.getByTestId('login-button').click()

  const dialog = page.getByRole('dialog', { name: 'Login' })
  await expect(dialog).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/login-modal.png` })
})
