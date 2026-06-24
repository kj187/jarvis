import { test, expect, freezeClock, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: fullscreen mode — header hidden, alert list fills the viewport.
 * List view is pre-set via localStorage so the fullscreen button is visible.
 * ESC hint fades after 2500ms; screenshot taken after it disappears.
 * Regenerate: make e2e-screenshot NAME=feature-fullscreen
 */
test('feature-fullscreen', async ({ page, am, jarvis }) => {
  await freezeClock(page)
  await page.addInitScript(() => {
    localStorage.setItem('jarvis-viewMode', 'list')
  })
  await dismissNoAuthNotice(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)
  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-group-row').first()).toBeVisible()
  await page.getByLabel('Enter fullscreen').click()
  // ESC hint fades after 2500ms — wait for clean list
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${DIR}/feature-fullscreen.png` })
})
