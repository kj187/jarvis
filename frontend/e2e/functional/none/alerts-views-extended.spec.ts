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

  // Sections lay out cards via CSS multi-column (`columnCount` inline
  // style) instead of `.flex-1` column divs. The first section (CRITICAL)
  // has more groups than any breakpoint's column count, so its columnCount
  // reflects the responsive breakpoint, not the per-section group-count cap.
  const columns = page.getByTestId('card-grid-columns').first()
  await expect(columns).toHaveCSS('column-count', '2')
})

test('B7 responsive column binning: 1 column at xs width', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.setViewportSize({ width: 400, height: 900 })
  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()

  const columns = page.getByTestId('card-grid-columns').first()
  await expect(columns).toHaveCSS('column-count', '1')
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
