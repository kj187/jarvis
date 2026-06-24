import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: full-page login form (full_protect mode, not authenticated).
 * page.route() overrides /auth/info so the frontend sees full_protect without
 * restarting the stack. No ensureInternalAdmin needed — setupRequired never
 * reaches the browser because /auth/info is fully mocked.
 * Regenerate: make e2e-screenshot NAME=auth-login-page MODE=internal
 */
test('auth-login-page', async ({ page }) => {
  await page.route(`${JARVIS_BASE_URL}/auth/info`, (route) =>
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
  await page.route(`${JARVIS_BASE_URL}/auth/me`, (route) =>
    route.fulfill({ status: 401, body: '' }),
  )

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Jarvis', level: 1 })).toBeVisible()
  await expect(page.getByPlaceholder('Username')).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/auth-login-page.png` })
})
