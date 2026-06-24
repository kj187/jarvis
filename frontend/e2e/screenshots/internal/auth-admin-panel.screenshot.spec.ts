import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { ensureInternalAdmin, loginInternal } from '../../support/auth'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: User Management admin sheet open.
 * Regenerate: make e2e-screenshot NAME=auth-admin-panel MODE=internal
 */
test('auth-admin-panel', async ({ page, am, jarvis }) => {
  await ensureInternalAdmin(page)
  await loginInternal(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.goto('/?state=active')
  await expect(page.getByTestId('user-menu')).toBeVisible()

  await page.getByTestId('user-menu').click()
  await expect(page.getByText('Logout')).toBeVisible()
  await page.getByText('Admin').click()

  await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/auth-admin-panel.png` })
})
