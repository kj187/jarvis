import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { fireWithHeatmapHistory, pickAlertWithHistory } from '../../support/heatmapHistory'
import { kubernetesAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: just the detail-panel heatmap section (label, info tooltip
 * trigger, range toggle, grid) — cropped to the element, not the full page,
 * for a docs image that doesn't need the rest of the panel as context.
 * Uses fireWithHeatmapHistory, which freezes the clock itself — see that
 * helper's docstring for why it can't use the shared fixed screenshot epoch.
 * Regenerate individually: make e2e-screenshot NAME=feature-heatmap-detail
 */
test('feature-heatmap-detail', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, kubernetesAlerts)

  const res = await page.request.get(`${JARVIS_BASE_URL}/api/v1/alerts`)
  const alerts: any[] = await res.json()
  const { fingerprint } = await pickAlertWithHistory(JARVIS_BASE_URL, alerts)

  await page.goto(`/?state=active&alert=${fingerprint}`)
  await expect(page.getByTestId('detail-panel')).toBeVisible()

  const heatmapSection = page.getByTestId('detail-heatmap-section')
  await expect(heatmapSection).toBeVisible()
  await page.waitForTimeout(300)

  await heatmapSection.screenshot({ path: `${DIR}/feature-heatmap-detail.png` })
})
