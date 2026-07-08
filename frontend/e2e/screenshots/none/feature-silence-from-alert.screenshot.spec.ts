import { test, expect, freezeClock, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { kubernetesAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

const AM_URL = process.env.E2E_ALERTMANAGER_URL ?? 'http://localhost:9094'

async function clearAllAMSilences(): Promise<void> {
  const res = await fetch(`${AM_URL}/api/v2/silences`)
  if (!res.ok) return
  const silences: Array<{ id: string; status: { state: string } }> = await res.json()
  for (const s of silences) {
    if (s.status.state !== 'expired') {
      await fetch(`${AM_URL}/api/v2/silence/${s.id}`, { method: 'DELETE' })
    }
  }
}

/**
 * Screenshot: create silence form pre-filled from an alert card (matchers auto-populated).
 * Regenerate: make e2e-screenshot NAME=feature-silence-from-alert
 */
test('feature-silence-from-alert', async ({ page, am, jarvis }) => {
  await clearAllAMSilences()
  await freezeClock(page)
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()

  // Since the bell action rail (PR #61) the full form opens via the bell
  // menu's "Silence…" entry, not a direct per-card button.
  await page.getByLabel('Silence options for this alert').first().click()
  await page.getByText('Silence…').first().click()

  await expect(page.getByRole('heading', { name: 'Create silence' })).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/feature-silence-from-alert.png` })
})
