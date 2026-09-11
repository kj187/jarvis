import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { ensureInternalAdmin } from '../../support/auth'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: full-page login form (full_protect mode, not authenticated).
 * ensureInternalAdmin creates a user so the backend's firstRunRedirect middleware
 * doesn't send GET / → 302 /setup (which would set window.location.pathname=/setup
 * and force SetupPage regardless of what page.route() mocks for /auth/info).
 * page.route() then overrides /auth/info to full_protect so App renders LoginPage.
 * Cropped to the card plus a modest margin (not the full viewport) — there's
 * no dashboard behind this page (it replaces the whole app), just flat
 * background, so a full-viewport shot is almost entirely empty space.
 * Regenerate: make e2e-screenshot NAME=auth-login-page MODE=internal
 */
test('auth-login-page', async ({ page }) => {
  await ensureInternalAdmin(page)

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
  const card = page.getByTestId('login-page-card')
  await page.waitForTimeout(300)

  const box = (await card.boundingBox())!
  const viewport = page.viewportSize()!
  const margin = 48
  const x = Math.max(0, box.x - margin)
  const y = Math.max(0, box.y - margin)
  const right = Math.min(viewport.width, box.x + box.width + margin)
  const bottom = Math.min(viewport.height, box.y + box.height + margin)

  await page.screenshot({
    path: `${DIR}/auth-login-page.png`,
    clip: { x, y, width: right - x, height: bottom - y },
  })
})
