import { test, expect } from '../../support/fixtures'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: first-run setup wizard (internal mode, no users yet).
 * Cropped to the card plus a modest margin — same reasoning as
 * auth-login-page: no dashboard behind it, just flat background.
 *   make e2e-screenshot NAME=setup-page MODE=internal
 */
test('setup-page', async ({ page }) => {
  await page.goto('/setup')
  await expect(page.getByRole('heading', { name: 'Jarvis' })).toBeVisible()
  await expect(page.getByText('Initial setup')).toBeVisible()
  const card = page.getByTestId('setup-page-card')
  await page.waitForTimeout(300)

  const box = (await card.boundingBox())!
  const viewport = page.viewportSize()!
  const margin = 48
  const x = Math.max(0, box.x - margin)
  const y = Math.max(0, box.y - margin)
  const right = Math.min(viewport.width, box.x + box.width + margin)
  const bottom = Math.min(viewport.height, box.y + box.height + margin)

  await page.screenshot({
    path: `${DIR}/auth-setup.png`,
    clip: { x, y, width: right - x, height: bottom - y },
  })
})
