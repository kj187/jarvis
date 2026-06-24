import { test, expect, freezeClock, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: filter bar open with a search term, showing narrowed results.
 * Regenerate: make e2e-screenshot NAME=feature-filter
 */
test('feature-filter', async ({ page, am, jarvis }) => {
  await freezeClock(page)
  await dismissNoAuthNotice(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()

  await page.getByRole('button', { name: 'Toggle search' }).click()
  await expect(page.getByPlaceholder('Search alerts…')).toBeVisible()
  await page.getByPlaceholder('Search alerts…').fill('OOM')
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/feature-filter.png`, fullPage: true })
})
