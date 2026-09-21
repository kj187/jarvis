import { test, expect } from '../../support/fixtures'
import { ensureInternalAdmin, loginInternal } from '../../support/auth'

/**
 * Catalog (internal mode): the Account panel is an SSO feature (it shows what the
 * identity provider reported). A local account keeps a plain name in the user menu.
 */
test('U4 a local account gets no Account entry in the user menu', async ({ page }) => {
  await ensureInternalAdmin(page)
  await loginInternal(page)
  await page.goto('/')

  await page.getByTestId('user-menu').click()
  await expect(page.getByTestId('user-menu-panel')).toContainText('e2e-admin')
  await expect(page.getByTestId('account-menu')).toHaveCount(0)
})
