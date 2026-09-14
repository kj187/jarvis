import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: the settings panel, cropped to its actual content rather than
 * the full viewport — the sheet frame is always full-height (`inset-y-0`)
 * regardless of content, so a screenshot of the dialog itself would carry a
 * lot of empty space below "Reset to defaults" once content is short.
 *
 * The panel (now that it includes the Labels section) is taller than the
 * default 900px viewport. `Locator.screenshot()` normally handles an element
 * taller than the viewport by scrolling and stitching multiple captures
 * together — but the sheet is `position: fixed`, which doesn't move with
 * page scroll, so that stitching captures the same fixed content repeatedly
 * instead of scrolling through it. Growing the viewport to fit the whole
 * panel before the single screenshot sidesteps that (same technique as
 * detail-tabs.screenshot.spec.ts uses a manual clip for — this content is
 * tall enough that scrolling-based stitching itself breaks, not just a
 * fixed-viewport clip).
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

  const content = panel.locator('.sheet-scroll > *').first()
  const contentHeight = await content.evaluate((el) => el.scrollHeight)
  const viewport = page.viewportSize()!
  await page.setViewportSize({ width: viewport.width, height: contentHeight + 32 })
  await page.waitForTimeout(100)

  await content.screenshot({ path: `${DIR}/feature-settings-panel.png` })
})
