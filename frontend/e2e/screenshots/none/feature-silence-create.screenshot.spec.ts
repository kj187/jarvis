import { test, expect, freezeClock, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: create silence form (blank, opened from the header button).
 * Background is populated with alerts so the dialog appears over a real dashboard.
 * Regenerate: make e2e-screenshot NAME=feature-silence-create
 */
test('feature-silence-create', async ({ page, am, jarvis }) => {
  await freezeClock(page)
  await dismissNoAuthNotice(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()

  await page.getByRole('button', { name: 'Create silence' }).first().click()
  await expect(page.getByText('Create Silence').first()).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/feature-silence-create.png` })
})
