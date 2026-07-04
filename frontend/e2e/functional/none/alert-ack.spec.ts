import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { kubernetesAlerts } from '../../fixtures/alerts'

const AM_URL = process.env.E2E_ALERTMANAGER_URL ?? 'http://localhost:9094'

async function clearAllAMSilences(): Promise<void> {
  const res = await fetch(`${AM_URL}/api/v2/silences`)
  if (!res.ok) return
  const silences = (await res.json()) as Array<{ id: string; status?: { state?: string } }>
  for (const silence of silences) {
    if (silence.status?.state !== 'expired') {
      await fetch(`${AM_URL}/api/v2/silence/${silence.id}`, { method: 'DELETE' })
    }
  }
}

/**
 * One-click Fast-Silence (idea 2.3): opening the Fast-Silence button's duration
 * menu in the detail panel and picking a duration (30m) creates a short-lived
 * exact-match silence for exactly that alert, with the auto comment
 * "Fast-Silence for <duration>", and the alert turns suppressed after the
 * auto-triggered poll.
 */
test.describe('One-click Fast-Silence', () => {
  test.afterEach(async () => {
    await clearAllAMSilences()
  })

  test('Fast-Silence in detail panel silences exactly that alert with a Fast-Silence comment', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    await page.goto('/?state=active')

    // Open the detail panel for the first alert.
    await page.getByTestId('alert-card').first().click()
    const detailPanel = page.getByTestId('detail-panel')
    await expect(detailPanel).toBeVisible()

    // Click the Fast-Silence button to open the duration menu, then pick 30m.
    await detailPanel.getByTestId('alert-ack-button').click()
    const menu = page.getByTestId('alert-ack-menu')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: '30m', exact: true }).click()

    // A silence with the auto "Fast-Silence for …" comment (default 30 min) is created,
    // and its matchers only contain REAL alert labels — no pseudo-labels (@receiver,
    // @cluster, receiver). Including a pseudo-label would make Alertmanager match nothing,
    // so the alert would never be suppressed (regression guard for that exact bug).
    let matcherNames: string[] = []
    await expect
      .poll(
        async () => {
          const res = await fetch(`${JARVIS_BASE_URL}/api/v1/silences`)
          if (!res.ok) return null
          const silences = (await res.json()) as Array<{
            comment: string
            matchers: Array<{ name: string }>
          }>
          const ack = silences.find((s) => s.comment === 'Fast-Silence for 30m')
          matcherNames = ack ? ack.matchers.map((m) => m.name) : []
          return ack ? ack.comment : null
        },
        { timeout: 15_000 },
      )
      .toBe('Fast-Silence for 30m')

    expect(matcherNames).toContain('alertname')
    for (const name of matcherNames) {
      expect(name.startsWith('@'), `matcher "${name}" must not be a pseudo-label`).toBe(false)
      expect(name).not.toBe('receiver')
    }
  })
})
