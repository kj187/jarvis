import { test, expect, Page } from '@playwright/test'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ASSETS_DIR = process.env.SCREENSHOTS_DIR ?? path.resolve(__dirname, '../test-results/auth-screenshots')

const MOCK_ALERTS_RESPONSE = { alerts: [], lastUpdated: new Date().toISOString() }

async function mockBaseAPIs(page: Page) {
  await page.route('**/api/v1/alerts**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ALERTS_RESPONSE) })
  )
  await page.route('**/api/v1/silences**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.route('**/api/v1/clusters**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ name: 'homelab', alertmanagerUrl: 'http://example.com' }]) })
  )
  // Block WebSocket
  await page.route('**/ws**', (route) => route.abort())
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
    await mockBaseAPIs(page)

    await page.goto('/')
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
    await mockBaseAPIs(page)

    await page.goto('/')
    await page.getByRole('button', { name: /login/i }).click()
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
    await mockBaseAPIs(page)

    await page.goto('/')
    await page.getByRole('button', { name: /login/i }).click()
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
    await mockBaseAPIs(page)

    await page.goto('/')
    await expect(page.locator('h1', { hasText: 'Jarvis' })).toBeVisible({ timeout: 8000 })
    await expect(page.getByText('Initial setup')).toBeVisible()
    await page.screenshot({ path: path.join(ASSETS_DIR, 'auth-setup.png') })
  })

  test('header user menu', async ({ page }) => {
    await page.route('**/auth/info', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mode: 'internal', loginUrl: '', setupRequired: false }),
      })
    )
    await page.route('**/auth/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: '1', username: 'admin', role: 'admin', provider: 'internal' }),
      })
    )
    await mockBaseAPIs(page)

    await page.goto('/')
    await page.waitForSelector('[aria-label="User menu"]', { timeout: 8000 })
    await page.click('[aria-label="User menu"]')
    await page.screenshot({ path: path.join(ASSETS_DIR, 'auth-user-menu.png') })
  })

  test('admin panel', async ({ page }) => {
    const mockUsers = [
      { id: '1', username: 'admin', role: 'admin', provider: 'internal', lastLoginAt: '2026-06-10T09:00:00Z' },
      { id: '2', username: 'alice', role: 'user', provider: 'internal', lastLoginAt: '2026-06-09T14:30:00Z' },
      { id: '3', username: 'bob', role: 'user', provider: 'oidc', lastLoginAt: '2026-06-08T11:00:00Z' },
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
    await page.route('**/admin/users', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockUsers) })
    )

    await page.goto('/')
    await page.waitForSelector('[aria-label="User menu"]', { timeout: 8000 })
    await page.click('[aria-label="User menu"]')
    await page.getByRole('button', { name: /admin/i }).click()
    await page.waitForSelector('table', { timeout: 8000 })
    await page.screenshot({ path: path.join(ASSETS_DIR, 'auth-admin-panel.png') })
  })
})
