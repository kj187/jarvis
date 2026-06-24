import { test, expect, freezeClock, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: list view showing alerts as grouped rows with severity badges.
 * Regenerate: make e2e-screenshot NAME=feature-list-view
 */
test('feature-list-view', async ({ page, am, jarvis }) => {
  await freezeClock(page)
  await dismissNoAuthNotice(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()
  await page.getByTitle('List View').click()
  await expect(page.getByRole('columnheader', { name: 'Alert Name' })).toBeVisible()

  // Expand the first group row to show individual alert rows
  const firstGroupRow = page.locator('table tbody tr[tabindex="0"]').first()
  await expect(firstGroupRow).toBeVisible()
  await firstGroupRow.click()
  await expect(page.getByTestId('alert-list-row').first()).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/feature-list-view.png`, fullPage: true })
})
