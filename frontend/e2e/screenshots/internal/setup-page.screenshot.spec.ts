import { test, expect } from '../../support/fixtures'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: first-run setup wizard (internal mode, no users yet).
 *   make e2e-screenshot NAME=setup-page MODE=internal
 */
test('setup-page', async ({ page }) => {
  await page.goto('/setup')
  await expect(page.getByRole('heading', { name: 'Jarvis' })).toBeVisible()
  await expect(page.getByText('Initial setup')).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/setup-page.png`, fullPage: true })
})
