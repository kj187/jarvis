import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { ensureInternalAdmin, loginInternal } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: User Management admin sheet open. Cropped to the sheet
 * itself (same content-bound-height technique as feature-settings-panel) —
 * the sheet is always full viewport height regardless of content.
 * Regenerate: make e2e-screenshot NAME=auth-admin-panel MODE=internal
 */
test('auth-admin-panel', async ({ page, am, jarvis }) => {
  await ensureInternalAdmin(page)
  await loginInternal(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, manyAlerts)

  await page.goto('/?state=active')
  await expect(page.getByTestId('user-menu')).toBeVisible()

  await page.getByTestId('user-menu').click()
  await expect(page.getByText('Logout')).toBeVisible()
  await page.getByRole('button', { name: 'Admin' }).click()

  const panel = page.getByRole('dialog', { name: 'User Management' })
  await expect(panel.getByRole('heading', { name: 'User Management' })).toBeVisible()
  await page.waitForTimeout(300)

  const panelBox = (await panel.boundingBox())!
  const contentBottom = await panel.evaluate((el) => {
    const kids = el.querySelector('.sheet-scroll')?.children ?? []
    const last = kids[kids.length - 1]
    return last ? last.getBoundingClientRect().bottom : 0
  })
  const height = Math.min(panelBox.height, Math.max(200, contentBottom + 16 - panelBox.y))

  await page.screenshot({
    path: `${DIR}/auth-admin-panel.png`,
    clip: { x: panelBox.x, y: panelBox.y, width: panelBox.width, height },
  })
})
