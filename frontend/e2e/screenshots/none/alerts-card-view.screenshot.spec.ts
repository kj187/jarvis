import { test, expect, freezeClock, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: alerts card view, populated with alerts grouped by severity.
 * Regenerate individually: make e2e-screenshot NAME=alerts-card-view
 */
test('alerts-card-view', async ({ page, am, jarvis }) => {
  await freezeClock(page)
  await dismissNoAuthNotice(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.goto('/?state=active&viewMode=card')
  
  // Wait for cards to render
  await expect(page.getByTestId('alert-card').first()).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/alerts-card-view.png`, fullPage: true })
})
