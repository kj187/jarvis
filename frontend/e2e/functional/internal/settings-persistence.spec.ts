import { test, expect } from '../../support/fixtures'
import { ensureInternalAdmin, loginInternal } from '../../support/auth'
import type { Page } from '@playwright/test'

/**
 * Catalog (internal mode): with an auth provider active and a logged-in user,
 * settings live in the account row, not the browser.
 *
 * Each test is self-contained (creates and logs in as its own admin) rather
 * than relying on state surviving *between* tests — the shared `page` fixture
 * (e2e/support/fixtures.ts) calls `jarvis.reset()` before every test, which
 * truncates the `users` table (and cascades `user_settings` with it), so a
 * later test can never see an earlier test's account or settings.
 *
 * Theme assertions use the auto-retrying `toHaveAttribute` (not a one-shot
 * `page.evaluate` read) because a reload with no local mirror to hydrate from
 * briefly shows the app default until GET /api/v1/settings resolves.
 */

function themeLocator(page: Page) {
  return page.locator('html')
}

async function setThemeViaMenu(page: Page, target: 'light' | 'dark') {
  const current = await themeLocator(page).getAttribute('data-theme')
  if (current === target) return
  const putResponse = page.waitForResponse(
    (res) => res.url().includes('/api/v1/settings') && res.request().method() === 'PUT',
  )
  await page.getByTestId('user-menu').click()
  await page.getByRole('button', { name: target === 'light' ? 'Light mode' : 'Dark mode' }).click()
  await putResponse
}

test('S1 theme set while logged in survives reload and a cleared localStorage', async ({ page }) => {
  await ensureInternalAdmin(page)
  await loginInternal(page)
  await page.goto('/')
  await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 10_000 })

  await setThemeViaMenu(page, 'light')
  await expect(themeLocator(page)).toHaveAttribute('data-theme', 'light')

  await page.reload()
  await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 10_000 })
  await expect(themeLocator(page)).toHaveAttribute('data-theme', 'light')

  // Clear localStorage entirely (simulates a different browser/device for the
  // same account) and log in again — whatever theme shows up now can only
  // have come from GET /api/v1/settings, proving the server is authoritative.
  await page.evaluate(() => localStorage.clear())
  await loginInternal(page)
  await page.reload()
  await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 10_000 })
  await expect(themeLocator(page)).toHaveAttribute('data-theme', 'light')
})

test('S2 reset to defaults clears the server row and reload stays on the default', async ({ page }) => {
  await ensureInternalAdmin(page)
  await loginInternal(page)
  await page.goto('/')
  await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 10_000 })

  await setThemeViaMenu(page, 'light')
  await expect(themeLocator(page)).toHaveAttribute('data-theme', 'light')

  await page.getByTestId('user-menu').click()
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()

  const deleteResponse = page.waitForResponse(
    (res) => res.url().includes('/api/v1/settings') && res.request().method() === 'DELETE',
  )
  await dialog.getByRole('button', { name: 'Reset all settings' }).click()
  await expect(dialog.getByRole('button', { name: /Click again to confirm/ })).toBeVisible()
  await dialog.getByRole('button', { name: /Click again to confirm/ }).click()
  await deleteResponse

  await expect(themeLocator(page)).toHaveAttribute('data-theme', 'dark') // app default
  await page.getByRole('button', { name: 'Close' }).click()

  await page.reload()
  await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 10_000 })
  await expect(themeLocator(page)).toHaveAttribute('data-theme', 'dark')
})
