import { test, expect, Page } from '@playwright/test'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ASSETS_DIR = process.env.SCREENSHOTS_DIR ?? path.resolve(__dirname, '../../docs/assets')

const MOCK_CLUSTERS = [
  { name: 'homelab', alertmanagerUrl: 'http://example.com', prometheusUrl: '', healthy: true, alertCount: 0 },
]

// Mock everything except auth routes — those are set per test.
async function mockBaseAPIs(page: Page) {
  await page.route('**/api/v1/alerts**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.route('**/api/v1/silences**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.route('**/api/v1/clusters**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_CLUSTERS) })
  )
  await page.route('**/api/v1/info**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'v0.8.0' }) })
  )
  await page.route('**/api/v1/status**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', clusters: 1, alerts: 0, ws_clients: 0 }) })
  )
  await page.route('**/ws**', (route) => route.abort())
}

// Navigate and wait for both auth requests to resolve before interacting.
async function gotoAndWaitForAuth(page: Page) {
  const [, ] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/info'), { timeout: 10_000 }),
    page.waitForResponse((r) => r.url().includes('/auth/me'), { timeout: 10_000 }),
    page.goto('/'),
  ])
  // Allow React to re-render with the resolved auth state.
  await page.waitForTimeout(800)
}

test.describe('Auth screenshots', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('no-auth notice', async ({ page }) => {
    await page.route('**/auth/info', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mode: 'none', loginUrl: '', setupRequired: false }),
      })
    )
    await page.route('**/auth/me', (route) => route.fulfill({ status: 401 }))
    await mockBaseAPIs(page)

    await gotoAndWaitForAuth(page)
    await expect(page.getByRole('dialog', { name: 'Authentication notice' })).toBeVisible({ timeout: 8000 })
    await page.screenshot({ path: path.join(ASSETS_DIR, 'auth-noauth-notice.png') })
  })

  test('login modal internal', async ({ page }) => {
    await page.route('**/auth/info', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mode: 'internal', loginUrl: '', setupRequired: false }),
      })
    )
    await page.route('**/auth/me', (route) => route.fulfill({ status: 401 }))
    await mockBaseAPIs(page)

    await gotoAndWaitForAuth(page)
    await page.locator('[aria-label="Login"]').click()
    await expect(page.getByRole('dialog', { name: 'Login' })).toBeVisible({ timeout: 8000 })
    await page.screenshot({ path: path.join(ASSETS_DIR, 'auth-login-internal.png') })
  })

  test('login modal oidc', async ({ page }) => {
    await page.route('**/auth/info', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mode: 'oidc', loginUrl: '/auth/oidc/start', setupRequired: false }),
      })
    )
    await page.route('**/auth/me', (route) => route.fulfill({ status: 401 }))
    await mockBaseAPIs(page)

    await gotoAndWaitForAuth(page)
    await page.locator('[aria-label="Login"]').click()
    await expect(page.getByRole('dialog', { name: 'Login' })).toBeVisible({ timeout: 8000 })
    await page.screenshot({ path: path.join(ASSETS_DIR, 'auth-login-oidc.png') })
  })

  test('setup page', async ({ page }) => {
    await page.route('**/auth/info', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mode: 'internal', loginUrl: '', setupRequired: true }),
      })
    )
    await page.route('**/auth/me', (route) => route.fulfill({ status: 401 }))
    await mockBaseAPIs(page)

    await gotoAndWaitForAuth(page)
    await expect(page.locator('h1', { hasText: 'Jarvis' })).toBeVisible({ timeout: 8000 })
    await expect(page.getByText('Initial setup')).toBeVisible()
    await page.screenshot({ path: path.join(ASSETS_DIR, 'auth-setup.png') })
  })

  test('header user menu', async ({ page }) => {
    const adminUser = { id: '1', username: 'admin', role: 'admin', provider: 'internal' }

    await page.route('**/auth/info', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mode: 'internal', loginUrl: '', setupRequired: false }),
      })
    )
    await page.route('**/auth/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(adminUser) })
    )
    await mockBaseAPIs(page)

    await gotoAndWaitForAuth(page)
    await page.locator('[aria-label="User menu"]').click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(ASSETS_DIR, 'auth-user-menu.png') })
  })

  test('admin panel', async ({ page }) => {
    const mockUsers = [
      { id: '1', username: 'admin', role: 'admin', provider: 'internal', createdAt: '2026-01-01T00:00:00Z', lastLoginAt: '2026-06-10T09:00:00Z' },
      { id: '2', username: 'alice', role: 'user', provider: 'internal', createdAt: '2026-01-02T00:00:00Z', lastLoginAt: '2026-06-09T14:30:00Z' },
      { id: '3', username: 'bob', role: 'user', provider: 'oidc', createdAt: '2026-01-03T00:00:00Z', lastLoginAt: '2026-06-08T11:00:00Z' },
    ]
    const adminUser = { id: '1', username: 'admin', role: 'admin', provider: 'internal' }

    await page.route('**/auth/info', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mode: 'internal', loginUrl: '', setupRequired: false }),
      })
    )
    await page.route('**/auth/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(adminUser) })
    )
    await mockBaseAPIs(page)
    await page.route('**/api/v1/admin/users**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockUsers) })
    )

    await gotoAndWaitForAuth(page)
    await page.locator('[aria-label="User menu"]').click()
    await page.getByRole('button', { name: /admin/i }).click()
    await page.waitForSelector('table', { timeout: 10_000 })
    await page.screenshot({ path: path.join(ASSETS_DIR, 'auth-admin-panel.png') })
  })
})

