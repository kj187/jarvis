import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: the settings panel, cropped to the panel itself rather than
 * the full viewport — the sheet is always full-height (`inset-y-0`)
 * regardless of content, so a plain element screenshot would still carry a
 * lot of empty space below "Reset to defaults"; crop to the actual content
 * bottom instead (same technique as detail-tabs.screenshot.spec.ts).
 * Regenerate: make e2e-screenshot NAME=feature-settings-panel
 */
test('feature-settings-panel', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, manyAlerts)

  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()

  await page.getByTestId('user-menu').click()
  await page.getByRole('button', { name: 'Settings' }).click()
  const panel = page.getByRole('dialog', { name: 'Settings' })
  await expect(panel).toBeVisible()
  await page.waitForTimeout(300)

  const panelBox = (await panel.boundingBox())!
  const contentBottom = await panel.evaluate((el) => {
    const kids = el.querySelector('.sheet-scroll')?.children ?? []
    const last = kids[kids.length - 1]
    return last ? last.getBoundingClientRect().bottom : 0
  })
  const height = Math.min(panelBox.height, Math.max(200, contentBottom + 16 - panelBox.y))

  await page.screenshot({
    path: `${DIR}/feature-settings-panel.png`,
    clip: { x: panelBox.x, y: panelBox.y, width: panelBox.width, height },
  })
})
