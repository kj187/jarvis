import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { kubernetesAlerts } from '../../fixtures/alerts'

const resolvedURL = /\/api\/v1\/alerts\?state=resolved(?:&|$)/

test('live-view refresh paths never fetch resolved history', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await page.addInitScript(() => {
    localStorage.setItem('jarvis-username', 'resolved-fetch-test')
    const NativeWebSocket = window.WebSocket
    const sockets: WebSocket[] = []
    ;(window as typeof window & { __closeResolvedFetchSockets?: () => void }).__closeResolvedFetchSockets = () => {
      sockets.forEach((socket) => socket.close())
    }
    class TrackedWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        sockets.push(this)
      }
    }
    window.WebSocket = TrackedWebSocket as typeof WebSocket
  })
  await page.clock.install()
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)
  let resolvedRequests = 0
  await page.route(resolvedURL, async (route) => {
    resolvedRequests += 1
    await route.continue()
  })

  await page.goto('/?state=active')
  await expect(page.getByTitle('Active')).toBeVisible()
  await expect(page.locator('[title="WebSocket connected"]').first()).toBeVisible()
  expect(resolvedRequests).toBe(0)

  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.getByRole('button', { name: 'Refresh now' }).first().click()

  await page.getByTestId('alert-card').first().click()
  await page.getByTestId('claim-button').click()
  await expect(page.getByTestId('detail-claim-badge')).toBeVisible()

  await page.evaluate(() => {
    (window as typeof window & { __closeResolvedFetchSockets?: () => void }).__closeResolvedFetchSockets?.()
  })
  await expect(page.locator('[title="WebSocket disconnected"]').first()).toBeVisible()
  await page.clock.fastForward(3_000)
  await expect(page.locator('[title="WebSocket connected"]').first()).toBeVisible()

  await page.clock.fastForward(61_000)
  expect(resolvedRequests).toBe(0)
})

test('resolved view shows loading and retry states and only fetches on demand', async ({ page }) => {
  await dismissNoAuthNotice(page)
  let attempt = 0
  let releaseFirst: (() => void) | undefined
  const firstResponse = new Promise<void>((resolve) => { releaseFirst = resolve })

  await page.route(resolvedURL, async (route) => {
    attempt += 1
    if (attempt === 1) {
      await firstResponse
    }
    if (attempt <= 3) {
      await route.fulfill({ status: 500, body: 'temporary failure' })
      return
    }
    await route.fulfill({ json: [] })
  })

  await page.goto('/?state=active')
  await page.getByTitle('Resolved').click()
  await expect(page.getByTestId('resolved-loading')).toBeVisible()
  releaseFirst?.()
  await expect(page.getByText('Failed to load resolved alerts.')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByText('No alerts')).toBeVisible()
  expect(attempt).toBe(4)
})

test('leaving resolved mode aborts its in-flight request', async ({ page }) => {
  await dismissNoAuthNotice(page)
  let requestFailed = false
  page.on('requestfailed', (request) => {
    if (resolvedURL.test(request.url())) requestFailed = true
  })
  await page.route(resolvedURL, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 10_000))
    await route.fulfill({ json: [] }).catch(() => {})
  })

  await page.goto('/?state=active')
  await page.getByTitle('Resolved').click()
  await expect(page.getByTestId('resolved-loading')).toBeVisible()
  await page.getByTitle('Active').click()
  await expect.poll(() => requestFailed).toBe(true)
})

test('closing the overview does not abort the resolved query still used by the page', async ({ page }) => {
  await dismissNoAuthNotice(page)
  let requestFailed = false
  let releaseResponse: (() => void) | undefined
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve })
  page.on('requestfailed', (request) => {
    if (resolvedURL.test(request.url())) requestFailed = true
  })
  await page.route(resolvedURL, async (route) => {
    await responseGate
    await route.fulfill({ json: [] })
  })

  await page.goto('/?state=resolved')
  await expect(page.getByTestId('resolved-loading')).toBeVisible()
  await page.getByRole('button', { name: 'Open alerts overview' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  releaseResponse?.()
  await expect(page.getByText('No alerts')).toBeVisible()
  expect(requestFailed).toBe(false)
})
