import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
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
 * Screenshot: active view showing an alert whose covering silence expires in ~8 minutes.
 * getEffectiveAlertState uses Date.now(), so we freeze the browser clock at
 * (silenceEndsAt - 8min) to put the silence inside the 15-minute expiry window.
 * The silence endsAt is set to real_now+20min so Alertmanager accepts it.
 * Regenerate: make e2e-screenshot NAME=feature-alert-expiring-silence
 */
test('feature-alert-expiring-silence', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  // Silence expires 20 minutes from real now — AM accepts future timestamps.
  const silenceEndsAt = new Date(Date.now() + 20 * 60 * 1000)

  await jarvis.createSilence('e2e', [
    { name: 'alertname', value: 'KubePodCrashLooping', isRegex: false, isEqual: true },
  ], {
    endsAt: silenceEndsAt,
    comment: 'Ongoing incident response',
    createdBy: 'sre-team',
  })

  await jarvis.poll()
  await waitForSuppressedAlerts(JARVIS_BASE_URL)

  // Freeze browser at silenceEndsAt - 8min → remaining = 8min < 15min → "expiring" badge
  await page.clock.setFixedTime(new Date(silenceEndsAt.getTime() - 8 * 60 * 1000))

  await page.goto('/?state=active')
  // The expiring alert is reclassified as active, so it shows here
  await expect(page.getByTestId('alert-card').first()).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/feature-alert-expiring-silence.png`, fullPage: true })
})
