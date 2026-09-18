import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'

// Reconnect delay is jittered 3000-6000ms (useWebSocket.ts's getReconnectDelay:
// 3000 + floor(random()*3001)). These tests use real wall-clock time rather
// than Playwright's fake clock: the reconnect timer interacts with a real
// WebSocket's real close/open events, and advancing a fake clock in one big
// jump was observed (during development of this spec) to fire the timer
// before its scheduled deadline in this exact scenario — real network
// events and fake timers don't compose reliably here. Real time with
// generous bounds is the robust choice.

// Patches WebSocket before the app's own script runs, so useWebSocket's
// connect() picks up the tracked class. __wsConnectCount counts every socket
// ever created (never decremented) — the single reliable "how many connection
// attempts happened" signal a test can read back via page.evaluate.
// __allSockets keeps every instance (including closed ones) so a test can
// simulate a stale socket's onclose firing after a newer one already exists.
async function installTrackedWebSocket(page: Page) {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket
    const live: WebSocket[] = []
    const all: WebSocket[] = []
    const w = window as typeof window & {
      __wsConnectCount: number
      __allSockets: WebSocket[]
      __closeAllWS: () => void
    }
    w.__wsConnectCount = 0
    w.__allSockets = all
    w.__closeAllWS = () => live.forEach((ws) => ws.close())
    class TrackedWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        live.push(this)
        all.push(this)
        w.__wsConnectCount += 1
        this.addEventListener('close', () => {
          const i = live.indexOf(this)
          if (i >= 0) live.splice(i, 1)
        })
      }
    }
    window.WebSocket = TrackedWebSocket as typeof WebSocket
  })
}

const connected = (page: Page) => page.locator('[title="WebSocket connected"]').first()
const disconnected = (page: Page) => page.locator('[title="WebSocket disconnected"]').first()
const connectCount = (page: Page) => page.evaluate(() => (window as typeof window & { __wsConnectCount: number }).__wsConnectCount)

test('initial connection happens immediately, without waiting for any reconnect delay', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await installTrackedWebSocket(page)

  await page.goto('/?state=active')
  await expect(connected(page)).toBeVisible({ timeout: 5_000 })
  expect(await connectCount(page)).toBe(1)
})

test('reconnect after a disconnect waits at least ~2.5s and completes within the 3-6s jitter window', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await installTrackedWebSocket(page)

  await page.goto('/?state=active')
  await expect(connected(page)).toBeVisible()
  expect(await connectCount(page)).toBe(1)

  await page.evaluate(() => (window as typeof window & { __closeAllWS: () => void }).__closeAllWS())
  await expect(disconnected(page)).toBeVisible()

  // Lower bound: the jittered delay is never below 3s, so shortly after
  // disconnecting (well under that) it must still be disconnected — a
  // regression to "reconnect immediately" would fail this.
  await page.waitForTimeout(2_500)
  await expect(disconnected(page)).toBeVisible()
  expect(await connectCount(page)).toBe(1)

  // Upper bound: 6s is the maximum jitter; a generous margin covers real
  // reconnect/refetch work.
  await expect(connected(page)).toBeVisible({ timeout: 5_000 })
  expect(await connectCount(page)).toBe(2)
})

test('reconnect triggers exactly one refetch of the active alerts list', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await installTrackedWebSocket(page)

  let alertsRequests = 0
  await page.route('**/api/v1/alerts', async (route) => {
    alertsRequests += 1
    await route.continue()
  })

  await page.goto('/?state=active')
  await expect(connected(page)).toBeVisible()
  const afterInitialLoad = alertsRequests
  expect(afterInitialLoad).toBeGreaterThan(0)

  await page.evaluate(() => (window as typeof window & { __closeAllWS: () => void }).__closeAllWS())
  await expect(disconnected(page)).toBeVisible()
  await expect(connected(page)).toBeVisible({ timeout: 8_000 })

  await expect(async () => {
    expect(alertsRequests).toBe(afterInitialLoad + 1)
  }).toPass({ timeout: 2_000 })
})

// useWebSocket is mounted once at the app root (App.tsx) for the page's whole
// lifetime — it never unmounts except via a real navigation, which destroys
// the entire JS realm (and with it any pending timer) trivially. The
// meaningful, reachable-in-a-running-app regression this guards against is a
// *stale* socket's close event still firing after a newer one has already
// taken over (wsRef.current moved on): it must not schedule a second
// reconnect timer or duplicate invalidation.
test("a stale socket's late close event schedules no extra reconnect attempt", async ({ page }) => {
  await dismissNoAuthNotice(page)
  await installTrackedWebSocket(page)

  await page.goto('/?state=active')
  await expect(connected(page)).toBeVisible()

  await page.evaluate(() => (window as typeof window & { __closeAllWS: () => void }).__closeAllWS())
  await expect(disconnected(page)).toBeVisible()
  await expect(connected(page)).toBeVisible({ timeout: 8_000 })
  expect(await connectCount(page)).toBe(2)

  // Fire the *first* (now-superseded) socket's close handler again, as if a
  // delayed event finally arrived after the second socket already connected.
  await page.evaluate(() => {
    const w = window as typeof window & { __allSockets: WebSocket[] }
    const stale = w.__allSockets[0]
    stale.onclose?.(new CloseEvent('close'))
  })

  // Give a wrongly-scheduled timer generous room to fire before asserting none did.
  await page.waitForTimeout(7_000)
  expect(await connectCount(page)).toBe(2)
})

