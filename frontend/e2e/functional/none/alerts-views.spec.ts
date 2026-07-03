import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { kubernetesAlerts, manyAlerts, crashLoopBurst } from '../../fixtures/alerts'

test('B2/B3 list<->card toggle persists', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()

  await page.getByTitle('List View').click()
  await expect(page.getByRole('columnheader', { name: 'Alert Name' })).toBeVisible()

  const stored = await page.evaluate(() => localStorage.getItem('jarvis-activeViewMode'))
  expect(stored).toBe('list')

  await page.reload()
  await expect(page.getByRole('columnheader', { name: 'Alert Name' })).toBeVisible()
})

test('B4 severity ordering starts with critical section', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.goto('/?state=active')
  await page.getByTitle('List View').click()
  const firstSeverityHeader = page.locator('tbody tr td span.text-xs.font-bold.uppercase').first()
  await expect(firstSeverityHeader).toHaveText(/critical/i)
})

test('B5 card expand/collapse shows "n of m" and +/- boundaries', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(crashLoopBurst)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, crashLoopBurst.length)

  await page.goto('/?state=active')
  // Wait for alerts to render before checking expand/collapse controls
  await expect(page.getByTestId('alert-card').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/\d+ of \d+/).first()).toBeVisible({ timeout: 10_000 })

  const minus = page.getByRole('button', { name: '−' }).first()
  const plus = page.getByRole('button', { name: '+' }).first()
  await expect(minus).toBeDisabled()
  await expect(plus).toBeEnabled()
  await plus.click()
  await expect(minus).toBeEnabled()
})

test('B6 fullscreen hint appears and closes with ESC', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.goto('/?state=active')
  await page.getByLabel('Enter fullscreen').click()
  await expect(page.getByText('Press')).toBeVisible()
  await expect(page.getByText('to exit fullscreen')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByText('to exit fullscreen')).toBeHidden()
})

test('B9 resolved mode uses flat list and page size controls', async ({ page, jarvis }) => {
  await dismissNoAuthNotice(page)

  await jarvis.seedResolved(
    Array.from({ length: 35 }, (_, i) => ({
      fingerprint: `resolved-${i}`,
      alertname: `ResolvedAlert${i}`,
      cluster: 'e2e',
      labels: {
        alertname: `ResolvedAlert${i}`,
        severity: 'warning',
        cluster: 'e2e',
      },
      startsAt: '2025-01-15T10:00:00Z',
      resolvedAt: '2025-01-15T11:00:00Z',
    })),
  )

  await page.goto('/?state=resolved')
  await expect(page.getByRole('columnheader', { name: 'Alert Name' })).toBeVisible()
  await expect(page.getByText('Per page:')).toBeVisible()
  await expect(page.getByRole('button', { name: '10', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '25', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '50', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '100', exact: true })).toBeVisible()
  await expect(page.getByText(/\d+–\d+ of 35/).first()).toBeVisible()
})
