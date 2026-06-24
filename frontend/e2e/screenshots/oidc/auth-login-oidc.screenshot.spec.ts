import { test, expect, freezeClock, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: login modal — OIDC mode with "Sign in with SSO" button.
 * Runs against the stack in oidc/write_protect mode (JARVIS_AUTH_PROVIDER=oidc).
 * The user is NOT logged in, so the login button in the header is visible.
 * Clicking it opens the login modal.
 * Regenerate: make e2e-screenshot NAME=auth-login-oidc MODE=oidc
 */
test('auth-login-oidc', async ({ page, am, jarvis }) => {
  await freezeClock(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.goto('/?state=active')
  await expect(page.getByTestId('login-button')).toBeVisible()
  await page.getByTestId('login-button').click()

  const dialog = page.getByRole('dialog', { name: 'Login' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Sign in with SSO' })).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/auth-login-oidc.png` })
})
