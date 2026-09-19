import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

/**
 * Drives the "Create silence" sheet up to — but not including — the final
 * Create click, for auth specs that need the login to interrupt the flow at
 * the last step. Returns the dialog so the caller can continue.
 *
 * Deliberately does NOT fill an author: with an auth provider the author is
 * the session user, and these specs run logged out or with an expired session.
 */
export async function fillSilenceUpToCreate(
  page: Page,
  opts: { alertname: string; reason: string },
): Promise<Locator> {
  await page.getByRole('button', { name: 'Create silence' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Create silence' })
  await expect(dialog).toBeVisible({ timeout: 5_000 })

  await dialog.getByRole('button', { name: 'label' }).first().click()
  const search = dialog.getByPlaceholder('Search…').first()
  await search.fill('alertname')
  await search.press('Enter')

  const value = dialog.locator('.flex.min-h-8 input').first()
  await value.fill(opts.alertname)
  await value.press('Enter')

  await dialog.getByRole('button', { name: '1h', exact: true }).click()
  await dialog.getByPlaceholder('Reason for the silence…').fill(opts.reason)
  return dialog
}

/** Preview → Create; returns once the preview step is shown and Create was clicked. */
export async function previewAndCreate(dialog: Locator): Promise<void> {
  const preview = dialog.getByRole('button', { name: 'Preview' })
  await expect(preview).toBeEnabled({ timeout: 8_000 })
  await preview.click()
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
}
