import { test, expect, freezeClock, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: alerts card view, populated with a rich set so it doesn't look
 * empty. Regenerate individually:  make e2e-screenshot NAME=card-view
 */
test('card-view', async ({ page, am, jarvis }) => {
  await freezeClock(page)
  await dismissNoAuthNotice(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/feature-card-view.png`, fullPage: true })
})
