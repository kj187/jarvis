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
 * Screenshot: suppressed alert list showing the covering silence per row
 * (silence ID, matchers, creator, comment, remaining time).
 * Accessed via ?state=suppressed URL param — shows the full silence context.
 * Regenerate: make e2e-screenshot NAME=feature-alert-active-silence
 */
test('feature-alert-active-silence', async ({ page, am, jarvis }) => {
  await freezeClock(page)
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await jarvis.createSilence('e2e', [
    { name: 'alertname', value: 'KubePodCrashLooping', isRegex: false, isEqual: true },
  ], { endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000), comment: 'Maintenance window — rolling restart', createdBy: 'sre-team' })

  await jarvis.poll()
  await waitForSuppressedAlerts(JARVIS_BASE_URL)

  await page.goto('/?state=suppressed')
  await expect(page.getByTestId('alert-group-row').first()).toBeVisible()
  await page.getByTestId('alert-group-row').first().click()
  await expect(page.getByTestId('alert-list-row').first()).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/feature-alert-active-silence.png`, fullPage: true })
})
