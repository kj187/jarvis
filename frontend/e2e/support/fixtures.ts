import { test as base, expect, type Page, type Locator } from '@playwright/test'

type Rootish = Page | Locator
import { AlertmanagerClient } from './alertmanager'
import { JarvisClient } from './jarvis'

const JARVIS_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8085'
const AM_URL = process.env.E2E_ALERTMANAGER_URL ?? 'http://localhost:9094'

/** Fixed wall-clock used to make relative timestamps deterministic in screenshots. */
export const FIXED_NOW = new Date('2025-01-15T12:00:00.000Z')

interface JarvisFixtures {
  am: AlertmanagerClient
  jarvis: JarvisClient
}

export const test = base.extend<JarvisFixtures>({
  am: async ({}, use) => {
    await use(new AlertmanagerClient(AM_URL))
  },
  jarvis: async ({}, use) => {
    await use(new JarvisClient(JARVIS_URL))
  },
  // Clean slate before every test: clear AM alerts + reset Jarvis DB/store.
  page: async ({ page, am, jarvis }, use) => {
    await am.clearAll()
    await jarvis.reset()
    await use(page)
  },
})

export { expect }

/** Freezes the browser clock so relative timestamps render identically. */
export async function freezeClock(page: Page, when: Date = FIXED_NOW): Promise<void> {
  await page.clock.setFixedTime(when)
}

/**
 * Fires alerts, triggers a poll, and waits until Jarvis reports the expected
 * number of active alerts via its API (poll interval is 1s in the e2e stack).
 */
export async function waitForActiveAlerts(
  jarvis: JarvisClient,
  baseURL: string,
  expectedMin: number,
  timeoutMs = 15_000,
): Promise<void> {
  await jarvis.poll()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${baseURL}/api/v1/alerts`)
    if (res.ok) {
      const alerts = (await res.json()) as unknown[]
      if (Array.isArray(alerts) && alerts.length >= expectedMin) return
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`timed out waiting for >=${expectedMin} active alerts`)
}

export const JARVIS_BASE_URL = JARVIS_URL

/**
 * Detail panel shows "Details" and "Comments" as tabs, "Details" active by
 * default — switch to the Comments tab before interacting with comment
 * testids.
 */
export async function expandComments(root: Rootish): Promise<void> {
  await root.getByTestId('detail-tab-comments').click()
}
