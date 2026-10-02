import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'

const ALERTS_URL = /\/api\/v1\/alerts(\?.*)?$/

const loadFailed = (page: Page) => page.getByTestId('live-load-failed')
const refreshFailed = (page: Page) => page.getByTestId('refresh-failed-banner')
const staleBanner = (page: Page) => page.getByTestId('stale-cluster-banner')
const wsLostBanner = (page: Page) => page.getByTestId('ws-lost-banner')
const connected = (page: Page) => page.locator('[title="WebSocket connected"]').first()
const disconnected = (page: Page) => page.locator('[title="WebSocket disconnected"]').first()

// A WebSocket that never touches the network: it opens on a microtask and only
// delivers what the test emits, so the page clock can be advanced freely
// without racing real socket events. __fakeWsCount counts every instance.
async function installFakeWebSocket(page: Page, { opens }: { opens: boolean }) {
  await page.addInitScript((opensImmediately) => {
    const w = window as typeof window & { __fakeWsCount: number; __emitWs: (data: string) => void }
    w.__fakeWsCount = 0
    const sockets: FakeWebSocket[] = []
    class FakeWebSocket {
      static readonly OPEN = 1
      readyState = 0
      onopen: (() => void) | null = null
      onclose: (() => void) | null = null
      onerror: (() => void) | null = null
      onmessage: ((e: { data: string }) => void) | null = null
      constructor() {
        w.__fakeWsCount += 1
        sockets.push(this)
        if (opensImmediately) {
          queueMicrotask(() => {
            this.readyState = 1
            this.onopen?.()
          })
        }
      }
      send() {}
      close() {
        this.readyState = 3
      }
      emit(data: string) {
        this.onmessage?.({ data })
      }
    }
    w.__emitWs = (data) => sockets[sockets.length - 1]?.emit(data)
    window.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  }, opens)
}

const fakeCount = (page: Page) => page.evaluate(() => (window as typeof window & { __fakeWsCount: number }).__fakeWsCount)
const emitHeartbeat = (page: Page) =>
  page.evaluate(() => (window as typeof window & { __emitWs: (d: string) => void }).__emitWs('{"type":"heartbeat","payload":null}'))

test('a failed first load shows an error with Retry instead of the empty state', async ({ page }) => {
  await dismissNoAuthNotice(page)
  // The server pushes the alert list on WebSocket connect, which would count as
  // loaded data; keep the socket out so only the failing HTTP load is in play.
  await installFakeWebSocket(page, { opens: false })
  await page.route(ALERTS_URL, (route) => route.fulfill({ status: 500, json: { error: 'internal error' } }))

  await page.goto('/?state=active')

  await expect(loadFailed(page)).toBeVisible({ timeout: 15_000 })
  await expect(loadFailed(page)).toContainText('not an empty list')
  await expect(page.getByText('No alerts', { exact: true })).toHaveCount(0)

  await page.unroute(ALERTS_URL)
  await page.route(ALERTS_URL, (route) => route.fulfill({ json: [] }))
  await loadFailed(page).getByRole('button', { name: 'Retry' }).click()

  await expect(loadFailed(page)).toBeHidden()
  await expect(page.getByText('No alerts', { exact: true })).toBeVisible()
})

test('a stale cluster is flagged with the age of its data', async ({ page }) => {
  await dismissNoAuthNotice(page)
  const polledAt = new Date(Date.now() - 12 * 60_000).toISOString()
  await page.route('**/api/v1/clusters', (route) =>
    route.fulfill({
      json: [
        {
          name: 'prod-eu',
          alertmanagerUrl: 'http://am.example',
          prometheusUrl: '',
          healthy: false,
          alertCount: 3,
          lastSuccessfulPollAt: polledAt,
          stale: true,
        },
        { name: 'prod-us', alertmanagerUrl: 'http://am2.example', prometheusUrl: '', healthy: true, alertCount: 1, stale: false },
      ],
    }),
  )

  await page.goto('/?state=active')

  await expect(staleBanner(page)).toHaveCount(1)
  await expect(staleBanner(page)).toContainText('prod-eu')
  await expect(staleBanner(page)).toContainText('min ago')
  await expect(staleBanner(page)).toContainText('not live')
})

test('a failed refresh after a successful load keeps the data and shows a banner', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket
    const live: WebSocket[] = []
    class TrackedWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        live.push(this)
      }
    }
    ;(window as typeof window & { __closeAllWS: () => void }).__closeAllWS = () => live.forEach((ws) => ws.close())
    window.WebSocket = TrackedWebSocket as typeof WebSocket
  })

  await page.goto('/?state=active')
  await expect(connected(page)).toBeVisible()
  await expect(refreshFailed(page)).toHaveCount(0)

  // The reconnect invalidates every query; make that refetch fail.
  await page.route(ALERTS_URL, (route) => route.fulfill({ status: 500, json: { error: 'internal error' } }))
  await page.evaluate(() => (window as typeof window & { __closeAllWS: () => void }).__closeAllWS())

  await expect(refreshFailed(page)).toBeVisible({ timeout: 25_000 })
  await expect(refreshFailed(page)).toContainText('last data received')
  await expect(loadFailed(page)).toHaveCount(0)
})

test('a WebSocket that stays down shows the interrupted notice only after 10s', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await installFakeWebSocket(page, { opens: false })

  await page.goto('/?state=active')

  await expect(disconnected(page)).toBeVisible()
  await expect(wsLostBanner(page)).toHaveCount(0)
  await expect(wsLostBanner(page)).toBeVisible({ timeout: 15_000 })
  await expect(wsLostBanner(page)).toContainText('every 60 seconds')
})

test('a silent socket is replaced after two missed heartbeats, a heartbeat keeps it alive', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await installFakeWebSocket(page, { opens: true })
  await page.clock.install()

  await page.goto('/?state=active')
  await expect(connected(page)).toBeVisible()
  expect(await fakeCount(page)).toBe(1)

  // Watchdog window is 2 × 54s + 6s = 114s. 100s of silence is still fine,
  // and a heartbeat at that point restarts the window.
  await page.clock.fastForward(100_000)
  await expect(connected(page)).toBeVisible()
  await emitHeartbeat(page)

  await page.clock.fastForward(100_000)
  await expect(connected(page)).toBeVisible()
  expect(await fakeCount(page)).toBe(1)

  // Now 114s pass with nothing: the socket is declared dead.
  await page.clock.fastForward(15_000)
  await expect(disconnected(page)).toBeVisible()
  expect(await fakeCount(page)).toBe(1)

  // The replacement socket is opened after the 3-6s reconnect delay.
  await page.clock.fastForward(6_100)
  await expect.poll(() => fakeCount(page)).toBe(2)
  await expect(connected(page)).toBeVisible()
})
