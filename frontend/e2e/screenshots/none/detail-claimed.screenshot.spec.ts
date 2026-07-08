import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { kubernetesAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: detail panel for a claimed alert showing claim badge and note.
 * Uses fireWithHeatmapHistory so the heatmap isn't a suspiciously empty grid
 * (it freezes the clock itself — see that helper's docstring).
 * Regenerate individually: make e2e-screenshot NAME=detail-claimed
 */
test('detail-claimed', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, kubernetesAlerts)

  // Get first alert's fingerprint
  const res = await page.request.get(`${JARVIS_BASE_URL}/api/v1/alerts`)
  const alerts: any[] = await res.json()
  const fingerprint = alerts[0].fingerprint
  
  // Set a claim on the alert
  await jarvis.setClaim(fingerprint, 'alice-dev', 'Investigating OOMKilled container')
  
  // Navigate to detail panel
  await page.goto(`/?state=active&alert=${fingerprint}`)
  
  // Wait for detail panel
  await expect(page.getByTestId('detail-panel')).toBeVisible()
  await expect(page.getByTestId('detail-claim-badge')).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/feature-detail-claimed.png`, fullPage: true })
})
