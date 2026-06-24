import { test, expect, freezeClock } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: create silence form (blank, opened from the header button).
 * Regenerate: make e2e-screenshot NAME=feature-silence-create
 */
test('feature-silence-create', async ({ page }) => {
  await freezeClock(page)
  await dismissNoAuthNotice(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Create silence' }).click()

  await expect(page.getByText('Create Silence').first()).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/feature-silence-create.png` })
})
