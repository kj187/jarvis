import { test, expect } from '../../support/fixtures'
import { loginOIDC } from '../../support/auth'

/**
 * Catalog (oidc mode): the user menu's name entry opens the Account panel, which
 * shows what the identity provider told Jarvis about the signed-in user — the mock
 * IdP issues groups=["Administrator"] in the claim the stack names via
 * JARVIS_OIDC_GROUPS_CLAIM=groups.
 */

test('U1 /auth/me reports the groups from the configured claim', async ({ page }) => {
  await loginOIDC(page)

  const me = await (await page.request.get('/auth/me')).json()
  expect(me.groupsClaim).toBe('groups')
  expect(me.groups).toEqual(['Administrator'])
  expect(typeof me.lastLoginAt).toBe('string')
})

test('U2 the user menu opens an Account panel with the user and the groups', async ({ page }) => {
  await loginOIDC(page)
  await page.goto('/')

  await page.getByTestId('user-menu').click()
  await page.getByTestId('account-menu').click()

  const panel = page.getByRole('dialog', { name: 'Account', exact: true })
  await expect(panel).toBeVisible()
  await expect(panel.getByText('e2e-admin', { exact: true })).toBeVisible()
  await expect(panel.getByText('admin@e2e.local')).toBeVisible()
  await expect(panel.getByTestId('account-role')).toHaveText('Admin')
  await expect(panel.getByRole('list', { name: 'Groups' }).getByText('Administrator', { exact: true })).toBeVisible()
  await expect(panel.getByText(/From claim/)).toContainText('groups')

  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
})

test('U3 Settings no longer carries account details', async ({ page }) => {
  await loginOIDC(page)
  await page.goto('/?settings=open')

  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByTestId('account-details')).toHaveCount(0)
})
