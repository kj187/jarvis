import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { kubernetesAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: one-click Fast-Silence button on an alert card, duration menu open.
 * Cropped to the toolbar + the row the menu opens in (not the full page) —
 * the fixture only fires a handful of alerts, so most of a full-page shot
 * is empty space below the menu.
 * Regenerate: make e2e-screenshot NAME=feature-fast-silence
 */
test('feature-fast-silence', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, kubernetesAlerts)

  await page.goto('/?state=active')
  const card = page.getByTestId('alert-card').first()
  await expect(card).toBeVisible()

  // Hover mirrors the primary desktop interaction: hovering the trigger opens
  // the duration menu without a click.
  await card.getByTestId('alert-ack-button').hover()
  const menu = page.getByTestId('alert-ack-menu')
  await expect(menu).toBeVisible()
  await page.waitForTimeout(300)

  const menuBox = (await menu.boundingBox())!
  const viewportWidth = page.viewportSize()!.width

  await page.screenshot({
    path: `${DIR}/feature-fast-silence.png`,
    clip: { x: 0, y: 0, width: viewportWidth, height: menuBox.y + menuBox.height + 16 },
  })
})
