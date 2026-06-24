import { test, expect, freezeClock, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: the "No authentication configured" notice over a populated
 * dashboard (none mode). This is the one screenshot that keeps the notice.
 *   make e2e-screenshot NAME=no-auth-notice
 */
test('no-auth-notice', async ({ page, am, jarvis }) => {
  await freezeClock(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.goto('/?state=active')
  await expect(page.getByRole('dialog', { name: 'Authentication notice' })).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/auth-noauth-notice.png` })
})
