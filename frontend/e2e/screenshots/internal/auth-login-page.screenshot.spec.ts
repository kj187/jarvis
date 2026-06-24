import { test, expect } from '../../support/fixtures'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: full-page login form (full_protect mode, not authenticated).
 * Uses page.route() to simulate full_protect without restarting the stack.
 * Regenerate: make e2e-screenshot NAME=auth-login-page MODE=internal
 */
test('auth-login-page', async ({ page }) => {
  await page.route('**/auth/info', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'internal',
        authMode: 'full_protect',
        loginUrl: '/auth/login',
        setupRequired: false,
      }),
    }),
  )
  await page.route('**/auth/me', (route) =>
    route.fulfill({ status: 401, body: '' }),
  )

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Jarvis', level: 1 })).toBeVisible()
  await expect(page.getByPlaceholder('Username')).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/auth-login-page.png` })
})
