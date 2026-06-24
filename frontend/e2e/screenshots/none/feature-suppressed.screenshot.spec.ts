import { test, expect, freezeClock, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { kubernetesAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

async function waitForSuppressedAlerts(baseURL: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${baseURL}/api/v1/alerts`)
    if (res.ok) {
      const alerts: Array<{ status: { state: string } }> = await res.json()
      if (alerts.some((a) => a.status.state === 'suppressed')) return
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('timed out waiting for suppressed alerts')
}

/**
 * Screenshot: suppressed view — alerts silenced by an active Alertmanager silence.
 * Regenerate: make e2e-screenshot NAME=feature-suppressed
 */
test('feature-suppressed', async ({ page, am, jarvis }) => {
  await freezeClock(page)
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await jarvis.createSilence('e2e', [
    { name: 'alertname', value: 'KubePodCrashLooping', isRegex: false, isEqual: true },
  ], { durationMinutes: 120, comment: 'Silenced during maintenance window' })

  await jarvis.poll()
  await waitForSuppressedAlerts(JARVIS_BASE_URL)

  await page.goto('/?state=suppressed')
  await expect(page.getByRole('columnheader', { name: 'Alert Name' })).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/feature-suppressed.png`, fullPage: true })
})
