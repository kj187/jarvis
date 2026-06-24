import { test, expect, freezeClock } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: resolved view — list of past alert lifecycles with timestamps.
 * Regenerate: make e2e-screenshot NAME=feature-resolved
 */
test('feature-resolved', async ({ page, jarvis }) => {
  await freezeClock(page)
  await dismissNoAuthNotice(page)

  await jarvis.seedResolved([
    { fingerprint: 'res-001', alertname: 'KubernetesOOMKill', cluster: 'e2e',
      labels: { severity: 'critical', namespace: 'kube-system' },
      startsAt: '2025-01-15T09:00:00Z', resolvedAt: '2025-01-15T09:47:00Z' },
    { fingerprint: 'res-002', alertname: 'KubernetesPodCrashLooping', cluster: 'e2e',
      labels: { severity: 'critical', namespace: 'production' },
      startsAt: '2025-01-15T08:30:00Z', resolvedAt: '2025-01-15T09:15:00Z' },
    { fingerprint: 'res-003', alertname: 'KubernetesNodeNotReady', cluster: 'e2e',
      labels: { severity: 'warning', node: 'worker-02' },
      startsAt: '2025-01-15T07:00:00Z', resolvedAt: '2025-01-15T07:22:00Z' },
    { fingerprint: 'res-004', alertname: 'HighMemoryUsage', cluster: 'e2e',
      labels: { severity: 'warning', namespace: 'monitoring' },
      startsAt: '2025-01-14T23:00:00Z', resolvedAt: '2025-01-15T00:30:00Z' },
    { fingerprint: 'res-005', alertname: 'DiskSpaceLow', cluster: 'e2e',
      labels: { severity: 'info', host: 'storage-01' },
      startsAt: '2025-01-14T20:00:00Z', resolvedAt: '2025-01-14T20:45:00Z' },
  ])

  await page.goto('/?state=resolved')
  await expect(page.getByTestId('alert-list-row').first()).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/feature-resolved.png`, fullPage: true })
})
