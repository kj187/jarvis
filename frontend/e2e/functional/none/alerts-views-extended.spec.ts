import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { manyAlerts, kubernetesAlerts } from '../../fixtures/alerts'

test('B7 responsive column binning: 2 columns at sm width', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.setViewportSize({ width: 641, height: 900 })
  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()

  // Grid renders sections with `.flex.gap-3` column containers.
  // Count direct `.flex-1` children of the first column container.
  const firstColumnRow = page.locator('.flex.gap-3').first()
  await expect(firstColumnRow.locator('> .flex-1')).toHaveCount(2)
})

test('B7 responsive column binning: 1 column at xs width', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.setViewportSize({ width: 400, height: 900 })
  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()

  const firstColumnRow = page.locator('.flex.gap-3').first()
  await expect(firstColumnRow.locator('> .flex-1')).toHaveCount(1)
})

test('B8 empty state icon shown when no alerts', async ({ page }) => {
  await dismissNoAuthNotice(page)
  // No alerts fired — jarvis.reset() was called in fixture setup

  await page.goto('/?state=active')

  const emptyState = page.locator('[aria-label="No alerts"]')
  await expect(emptyState).toBeVisible({ timeout: 10_000 })
})

test('B10 suppressed view shows silenced alerts', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  const now = Date.now()
  await jarvis.createSilence(
    'e2e',
    [{ name: 'alertname', value: 'KubePodCrashLooping', isRegex: false, isEqual: true }],
    {
      startsAt: new Date(now - 5 * 60 * 1000),
      endsAt: new Date(now + 60 * 60 * 1000), // 60min > 15min expiry threshold
      createdBy: 'e2e-tester',
      comment: 'b10-suppressed-test',
    },
  )
  await jarvis.poll()

  // Poll again and give the suppressed state time to propagate
  await new Promise((r) => setTimeout(r, 2000))
  await jarvis.poll()

  await page.goto('/?state=suppressed')

  // The suppressed alert should appear in the view
  await expect(page.getByText('KubePodCrashLooping').first()).toBeVisible({ timeout: 15_000 })
})
