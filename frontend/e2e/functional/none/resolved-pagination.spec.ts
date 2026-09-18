import { test, expect } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'

test('resolved history uses bounded server pages without a legacy full fetch', async ({ page, jarvis }) => {
  await dismissNoAuthNotice(page)
  await jarvis.seedResolved(Array.from({ length: 61 }, (_, index) => ({
    fingerprint: (index + 1).toString(16).padStart(16, '0'),
    alertname: `PagedResolved${String(index + 1).padStart(2, '0')}`,
    cluster: 'e2e',
    labels: { alertname: `PagedResolved${String(index + 1).padStart(2, '0')}`, severity: 'warning' },
    startsAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    resolvedAt: new Date(Date.UTC(2026, 0, 1, 1, index)).toISOString(),
  })))

  let legacyRequests = 0
  const pageRequests: URL[] = []
  await page.route(/\/api\/v1\/alerts(?:\?|$)/, async (route) => {
    if (new URL(route.request().url()).searchParams.get('state') === 'resolved') legacyRequests += 1
    await route.continue()
  })
  await page.route(/\/api\/v1\/alerts\/resolved(?:\?|$)/, async (route) => {
    const url = new URL(route.request().url())
    pageRequests.push(url)
    if (url.searchParams.get('offset') === '25') await new Promise((resolve) => setTimeout(resolve, 150))
    await route.continue()
  })

  await page.goto('/?state=resolved')
  await expect(page.getByText('1–25 of 61').first()).toBeVisible()
  await page.getByRole('button', { name: 'Next page' }).first().click()
  await expect(page.getByTestId('resolved-page-loading')).toBeVisible()
  await expect(page.getByText('26–50 of 61').first()).toBeVisible()
  await page.getByRole('button', { name: 'Last page' }).first().click()
  await expect(page.getByText('51–61 of 61').first()).toBeVisible()

  expect(legacyRequests).toBe(0)
  expect(pageRequests.map((url) => [url.searchParams.get('limit'), url.searchParams.get('offset')]))
    .toEqual(expect.arrayContaining([['25', '0'], ['25', '25'], ['25', '50']]))
})

test('a selected resolved alert outside the current page is fetched by fingerprint and cluster', async ({ page, jarvis }) => {
  await dismissNoAuthNotice(page)
  const alerts = Array.from({ length: 30 }, (_, index) => ({
    fingerprint: (index + 1).toString(16).padStart(16, '0'),
    alertname: `OffPageResolved${String(index + 1).padStart(2, '0')}`,
    cluster: 'e2e',
    labels: { alertname: `OffPageResolved${String(index + 1).padStart(2, '0')}`, severity: 'warning' },
    startsAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    resolvedAt: new Date(Date.UTC(2026, 0, 1, 1, index)).toISOString(),
  }))
  await jarvis.seedResolved(alerts)

  const detailRequests: URL[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith('/api/v1/alerts/resolved') && url.searchParams.has('fingerprint')) {
      detailRequests.push(url)
    }
  })

  await page.goto(`/?state=resolved&alert=${encodeURIComponent(`e2e::${alerts[0].fingerprint}`)}`)
  await expect(page.getByTestId('detail-panel')).toContainText('OffPageResolved01')
  expect(detailRequests).toHaveLength(1)
  expect(detailRequests[0].searchParams.get('fingerprint')).toBe(alerts[0].fingerprint)
  expect(detailRequests[0].searchParams.get('cluster')).toBe('e2e')
  expect(detailRequests[0].searchParams.has('limit')).toBe(false)
  expect(detailRequests[0].searchParams.has('offset')).toBe(false)
})
