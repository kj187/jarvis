import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { ensureInternalAdmin } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: the login modal (internal mode). Requires the admin to already
 * exist so the app shows the dashboard with a login button.
 * Cropped to the modal panel plus a margin (not the full page) — the margin
 * keeps the dimmed dashboard visible around the edges, same technique as
 * no-auth-notice.
 *   make e2e-screenshot NAME=login-modal MODE=internal
 */
test('login-modal', async ({ page, am, jarvis }) => {
  await ensureInternalAdmin(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, manyAlerts)

  await page.goto('/?state=active')
  await page.getByTestId('user-menu').click()
  await page.getByTestId('login-button').click()

  const dialog = page.getByRole('dialog', { name: 'Login' })
  await expect(dialog).toBeVisible()
  const panel = page.getByTestId('login-modal-panel')
  await expect(panel).toBeVisible()
  await page.waitForTimeout(300)

  const box = (await panel.boundingBox())!
  const viewport = page.viewportSize()!
  const margin = 80
  const x = Math.max(0, box.x - margin)
  const y = Math.max(0, box.y - margin)
  const right = Math.min(viewport.width, box.x + box.width + margin)
  const bottom = Math.min(viewport.height, box.y + box.height + margin)

  await page.screenshot({
    path: `${DIR}/auth-login-internal.png`,
    clip: { x, y, width: right - x, height: bottom - y },
  })
})
