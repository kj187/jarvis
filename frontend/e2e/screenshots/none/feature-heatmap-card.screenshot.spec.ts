import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { fireWithHeatmapHistory, pickAlertWithHistory } from '../../support/heatmapHistory'
import { kubernetesAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: a single alert card entry showing the 14-day firing sparkline
 * under the timestamp row — cropped to the entry element, not the full page.
 * Uses fireWithHeatmapHistory, which freezes the clock itself — see that
 * helper's docstring for why it can't use the shared fixed screenshot epoch.
 * Regenerate individually: make e2e-screenshot NAME=feature-heatmap-card
 */
test('feature-heatmap-card', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, kubernetesAlerts)

  const res = await page.request.get(`${JARVIS_BASE_URL}/api/v1/alerts`)
  const alerts: any[] = await res.json()
  const { fingerprint } = await pickAlertWithHistory(JARVIS_BASE_URL, alerts)

  await page.goto('/?state=active&viewMode=card')
  const card = page.locator(`[data-fingerprint="${fingerprint}"]`)
  await expect(card).toBeVisible()
  await page.waitForTimeout(300)

  await card.screenshot({ path: `${DIR}/feature-heatmap-card.png` })
})
