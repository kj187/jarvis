import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { manyAlerts } from '../../fixtures/alerts'

/**
 * Catalog B1 (none mode): the card view loads real alerts polled from the e2e
 * Alertmanager and renders them as cards.
 */
test('card view renders polled alerts', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.goto('/?state=active')

  const cards = page.getByTestId('alert-card')
  await expect(cards.first()).toBeVisible()
  await expect(cards).toHaveCount(manyAlerts.length)
})
