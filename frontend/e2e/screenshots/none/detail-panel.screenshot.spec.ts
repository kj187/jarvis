import { test, expect, freezeClock, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { kubernetesAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: detail panel opened for an alert showing labels, annotations, stats.
 * Regenerate individually: make e2e-screenshot NAME=detail-panel
 */
test('detail-panel', async ({ page, am, jarvis }) => {
  await freezeClock(page)
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.goto('/?state=active')
  
  // Get first alert's fingerprint
  const res = await page.request.get(`${JARVIS_BASE_URL}/api/v1/alerts`)
  const alerts: any[] = await res.json()
  const fingerprint = alerts[0].fingerprint
  
  // Navigate to detail panel
  await page.goto(`/?state=active&alert=${fingerprint}`)
  
  // Wait for detail panel
  await expect(page.getByTestId('detail-panel')).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/detail-panel.png`, fullPage: true })
})
