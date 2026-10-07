import { test, expect } from '../../support/fixtures'
import { ensureInternalAdmin } from '../../support/auth'

/**
 * Catalog (internal mode, write_protect): when /auth/me cannot be answered
 * (the server returns 503 during a database blip) the app must not look signed
 * out and must not go blank. Alerts stay readable, a banner explains and Retry
 * recovers once the server answers again.
 */
test.describe('Auth state unavailable (internal)', () => {
  test('A1 /auth/me 503: the app keeps rendering with a banner, Retry recovers', async ({ page }) => {
    await ensureInternalAdmin(page)

    await page.route('**/auth/me', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"service unavailable"}' }),
    )
    await page.goto('/')

    // The hydrate retries for ~10 s before it gives up and shows the banner.
    const banner = page.getByTestId('auth-unavailable-banner')
    await expect(banner).toBeVisible({ timeout: 25_000 })
    await expect(page.getByTestId('auth-error')).toHaveCount(0)
    // The app itself is rendered, not replaced by an error page.
    await expect(page.locator('header').first()).toBeVisible()

    await page.unroute('**/auth/me')
    await banner.getByRole('button', { name: 'Retry' }).click()
    await expect(banner).toBeHidden({ timeout: 10_000 })
  })
})
