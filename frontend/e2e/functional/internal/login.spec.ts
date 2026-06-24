import { test, expect } from '../../support/fixtures'
import { ensureInternalAdmin, loginInternal, INTERNAL_ADMIN } from '../../support/auth'

/**
 * Catalog (internal mode): first-run setup creates the admin, then login via
 * the internal provider authenticates the session.
 */
test('internal setup + login authenticates the user', async ({ page }) => {
  // Fresh stack → no users yet → /auth/info reports setupRequired.
  const info = await (await page.request.get('/auth/info')).json()
  expect(info.mode).toBe('internal')

  await ensureInternalAdmin(page)
  await loginInternal(page)

  const me = await (await page.request.get('/auth/me')).json()
  expect(me.username).toBe(INTERNAL_ADMIN.username)
  expect(me.role).toBe('admin')

  // The authenticated user menu is visible in the header.
  await page.goto('/?state=active')
  await expect(page.getByTestId('user-menu')).toBeVisible()
})
