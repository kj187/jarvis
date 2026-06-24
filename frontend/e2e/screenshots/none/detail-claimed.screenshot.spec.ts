import { test, expect, freezeClock, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { kubernetesAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: detail panel for a claimed alert showing claim badge and note.
 * Regenerate individually: make e2e-screenshot NAME=detail-claimed
 */
test('detail-claimed', async ({ page, am, jarvis }) => {
  await freezeClock(page)
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

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
