import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { loginOIDC } from '../../support/auth'

/**
 * Catalog (oidc mode): the full Authorization-Code-with-PKCE flow against the
 * mock OIDC server logs the user in and maps the admin claim (groups=Administrator).
 */
test('oidc login flow authenticates and maps admin role', async ({ page }) => {
  const info = await (await page.request.get('/auth/info')).json()
  expect(info.mode).toBe('oidc')

  await loginOIDC(page)

  const me = await (await page.request.get('/auth/me')).json()
  expect(me.username).toBe('e2e-admin')
  expect(me.role).toBe('admin')

  await expect(page.getByTestId('user-menu')).toBeVisible()
})

test('I3 write_protect oidc mode shows SSO login button on write attempt', async ({ page, am, jarvis }) => {
  // Do NOT log in — test as unauthenticated user in write_protect oidc mode

  await am.fire([
    {
      labels: { alertname: 'I3OIDCLoginAlert', severity: 'warning', cluster: 'e2e' },
      annotations: { summary: 'I3 OIDC login modal test' },
    },
  ])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

  await page.goto('/?state=active')
  const firstCard = page.getByTestId('alert-card').first()
  await expect(firstCard).toBeVisible({ timeout: 10_000 })
  await firstCard.click()

  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()

  // Type a comment and submit — triggers LoginModal in write_protect oidc mode
  const commentInput = page.getByTestId('detail-comment-input')
  await expect(commentInput).toBeVisible({ timeout: 8_000 })
  await commentInput.fill('I3 oidc test comment')

  await page.getByTestId('detail-comment-submit').click()

  // LoginModal for OIDC mode shows "Login with SSO" button, not username/password
  const loginModal = page.getByRole('dialog', { name: 'Login', exact: true })
  await expect(loginModal).toBeVisible({ timeout: 8_000 })
  await expect(loginModal.getByRole('button', { name: 'Login with SSO' })).toBeVisible()
  // Should NOT show internal credentials fields
  await expect(loginModal.getByPlaceholder('Username')).toHaveCount(0)
  await expect(loginModal.getByPlaceholder('Password')).toHaveCount(0)
})
