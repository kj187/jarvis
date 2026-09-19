import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { fillSilenceUpToCreate, previewAndCreate } from '../../support/silenceForm'

/**
 * Catalog (oidc mode): SSO login runs in a popup, so the page underneath — here a
 * fully filled silence form — is untouched and the interrupted Create completes
 * once the popup closes. The full-page fallback returns to the page it left.
 */

test('S1 SSO login in a popup keeps the silence form and completes the Create', async ({ page, am, jarvis }) => {
  await am.fire([{ labels: { alertname: 'S1SsoAlert', severity: 'warning', cluster: 'e2e' } }])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

  await page.goto('/')
  const dialog = await fillSilenceUpToCreate(page, { alertname: 'S1SsoAlert', reason: 'S1 sso popup resume' })
  await previewAndCreate(dialog)

  const loginModal = page.getByRole('dialog', { name: 'Login', exact: true })
  await expect(loginModal).toBeVisible({ timeout: 8_000 })

  const popupPromise = page.waitForEvent('popup')
  await loginModal.getByRole('button', { name: 'Login with SSO' }).click()
  const popup = await popupPromise
  await popup.waitForEvent('close', { timeout: 15_000 })

  await expect(loginModal).toBeHidden({ timeout: 8_000 })
  await expect(dialog.getByText('Silence submitted')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('user-menu')).toBeVisible()
})

test('S2 return_to brings a full-page SSO login back to the page it left', async ({ page }) => {
  await page.goto('/auth/oidc/start?return_to=' + encodeURIComponent('/?state=active'))
  await page.waitForURL('**/?state=active')
  await expect(page.getByTestId('user-menu')).toBeVisible()
})

test('S3 return_to never leaves the origin', async ({ page }) => {
  await page.goto('/auth/oidc/start?return_to=' + encodeURIComponent('//evil.example/'))
  await page.waitForURL((url) => url.pathname === '/')
  expect(new URL(page.url()).origin).toBe(new URL(JARVIS_BASE_URL).origin)
})
