import { test, expect } from '../../support/fixtures'

/**
 * Catalog (none mode): the "No authentication configured" notice is shown when
 * JARVIS_AUTH_PROVIDER=none and can be dismissed. This is the one test that
 * intentionally does NOT pre-dismiss the notice.
 */
test('no-auth notice appears and can be dismissed', async ({ page }) => {
  await page.goto('/?state=active')

  const dialog = page.getByRole('dialog', { name: 'Authentication notice' })
  await expect(dialog).toBeVisible()

  await page.getByRole('button', { name: "Got it, don't show again" }).click()
  await expect(dialog).toBeHidden()

  // Stays dismissed after reload (localStorage flag persists).
  await page.reload()
  await expect(dialog).toBeHidden()
})
