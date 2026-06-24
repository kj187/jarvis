import { test, expect } from '../../support/fixtures'
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
