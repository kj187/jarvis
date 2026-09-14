import { test, expect } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: the Labels section of the Settings panel (issue #189) — cropped
 * to just that section rather than the whole panel (same crop-to-content
 * technique as feature-settings-panel.screenshot.spec.ts).
 * Regenerate: make e2e-screenshot NAME=feature-settings-labels
 */
test('feature-settings-labels', async ({ page, am }) => {
  await dismissNoAuthNotice(page)
  await am.fire(manyAlerts)
  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()

  await page.getByTestId('user-menu').click()
  await page.getByRole('button', { name: 'Settings' }).click()
  const panel = page.getByRole('dialog', { name: 'Settings' })
  await expect(panel).toBeVisible()
  await page.waitForTimeout(300)

  const section = panel.locator('h3', { hasText: 'Labels' }).locator('..')
  await expect(section).toBeVisible()

  // `Locator.screenshot()` (unlike a manual `page.screenshot({ clip })`) scrolls
  // the element into view and captures its full bounding box even where that
  // exceeds the sheet's own scrollable viewport — the section is taller than
  // the dialog once alerts contribute more than a handful of label keys.
  await section.screenshot({ path: `${DIR}/feature-settings-labels.png` })
})
