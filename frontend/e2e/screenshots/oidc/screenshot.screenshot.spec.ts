import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { loginOIDC } from '../../support/auth'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * README hero screenshot — taken in OIDC mode so the header shows the user icon.
 *
 * State seeded to show the breadth of Jarvis features in one view:
 * - 3 active silences → Silences pill shows a non-zero count
 * - KubePodCrashLooping: silence expiring in ~4 min (expiring badge, visible in active tab)
 * - KubeNodeNotReady: silence expiring in ~3 days  (suppressed, contributes to count)
 * - PostgresReplicationLag: silence expiring in ~5 days (suppressed, contributes to count)
 * - 3 alerts claimed by sre-oncall
 *
 * Regenerate: make e2e-screenshot NAME=screenshot MODE=oidc
 */
test('screenshot', async ({ page, am, jarvis }) => {
  // Login first — session cookie must be in place before any page navigation.
  await loginOIDC(page)

  await am.fire(manyAlerts)
  await jarvis.poll()

  // Wait for all alerts to land in Jarvis, then grab fingerprints.
  const deadline = Date.now() + 15_000
  let alerts: Array<{ fingerprint: string; labels: Record<string, string> }> = []
  while (Date.now() < deadline) {
    const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
    if (res.ok) {
      const data: typeof alerts = await res.json()
      if (data.length >= manyAlerts.length) {
        alerts = data
        break
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  if (alerts.length < manyAlerts.length) {
    throw new Error(`timed out waiting for ${manyAlerts.length} alerts, got ${alerts.length}`)
  }

  // Claim 3 alerts so the claim badges are visible on cards.
  const byName = (name: string) => alerts.find((a) => a.labels['alertname'] === name)
  for (const name of ['KubeDeploymentReplicasMismatch', 'HighRequestLatency', 'IngressHigh5xxRate']) {
    const alert = byName(name)
    if (alert) await jarvis.setClaim(alert.fingerprint, 'sre-oncall', 'Investigating')
  }

  // 1) Silence expiring in 4 min (browser-clock trick).
  const soonEndsAt = new Date(Date.now() + 20 * 60 * 1000)
  await jarvis.createSilence('e2e', [
    { name: 'alertname', value: 'KubePodCrashLooping', isRegex: false, isEqual: true },
  ], {
    endsAt: soonEndsAt,
    createdBy: 'sre-team',
    comment: 'Incident response — rolling restart in progress',
  })

  // 2) Silence expiring in ~3 days.
  await jarvis.createSilence('e2e', [
    { name: 'alertname', value: 'KubeNodeNotReady', isRegex: false, isEqual: true },
  ], {
    endsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    createdBy: 'ops-team',
    comment: 'Scheduled node maintenance window',
  })

  // 3) Silence expiring in ~5 days.
  await jarvis.createSilence('e2e', [
    { name: 'alertname', value: 'PostgresReplicationLag', isRegex: false, isEqual: true },
  ], {
    endsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    createdBy: 'data-team',
    comment: 'DB failover in progress — replica resync expected by Friday',
  })

  await jarvis.poll()

  // Freeze browser 4 minutes before soonEndsAt → KubePodCrashLooping remaining = 4 min
  // → getEffectiveAlertState returns 'active' → card shows "Silence expires in 4 min" badge
  await page.clock.setFixedTime(new Date(soonEndsAt.getTime() - 4 * 60 * 1000))

  await page.goto('/?state=active')
  await expect(page.getByTestId('user-menu')).toBeVisible()
  await expect(page.getByTestId('alert-card').first()).toBeVisible()
  await page.waitForTimeout(500)

  await page.screenshot({ path: `${DIR}/screenshot.png`, fullPage: true })
})
