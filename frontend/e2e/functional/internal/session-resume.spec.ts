import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { ensureInternalAdmin, loginInternal, INTERNAL_ADMIN } from '../../support/auth'
import { fillSilenceUpToCreate, previewAndCreate } from '../../support/silenceForm'
import type { Page } from '@playwright/test'

const AM_URL = process.env.E2E_ALERTMANAGER_URL ?? 'http://localhost:9094'

/**
 * Catalog (internal mode): a login — needed up front or because the session ran
 * out mid-task — happens on top of the current page and the interrupted action
 * completes afterwards. Nothing the user typed is lost, nothing reloads.
 */

async function clearAllAMSilences(): Promise<void> {
  const res = await fetch(`${AM_URL}/api/v2/silences`)
  if (!res.ok) return
  const silences = (await res.json()) as Array<{ id: string; status?: { state?: string } }>
  for (const s of silences) {
    if (s.status?.state !== 'expired') await fetch(`${AM_URL}/api/v2/silence/${s.id}`, { method: 'DELETE' })
  }
}

async function logInThroughModal(page: Page): Promise<void> {
  const loginModal = page.getByRole('dialog', { name: 'Login', exact: true })
  await expect(loginModal).toBeVisible({ timeout: 8_000 })
  await loginModal.getByPlaceholder('Username').fill(INTERNAL_ADMIN.username)
  await loginModal.getByPlaceholder('Password').fill(INTERNAL_ADMIN.password)
  await loginModal.getByRole('button', { name: 'Login' }).click()
  await expect(loginModal).toBeHidden({ timeout: 8_000 })
}

test.describe('Login resumes the interrupted action (internal)', () => {
  test.afterEach(async () => {
    await clearAllAMSilences()
  })

  test('R1 logged out: silence Preview is enabled, login is asked at Create and the silence is created', async ({ page, am, jarvis }) => {
    await ensureInternalAdmin(page)
    await am.fire([{ labels: { alertname: 'R1ResumeAlert', severity: 'warning', cluster: 'e2e' } }])
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

    await page.goto('/')
    const dialog = await fillSilenceUpToCreate(page, { alertname: 'R1ResumeAlert', reason: 'R1 resume after login' })

    // Not logged in — yet the form is fully usable.
    await expect(dialog.getByRole('button', { name: 'Preview' })).toBeEnabled({ timeout: 8_000 })
    await previewAndCreate(dialog)

    await logInThroughModal(page)

    // The very same form carried on: no reload, the silence got created.
    await expect(dialog.getByText('Silence submitted')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('user-menu')).toBeVisible()
  })

  test('R2 session expires while the form is open: 401 opens the login, the request is replayed after it', async ({ page, am, jarvis }) => {
    await ensureInternalAdmin(page)
    await loginInternal(page)
    await am.fire([{ labels: { alertname: 'R2ExpiredAlert', severity: 'warning', cluster: 'e2e' } }])
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

    await page.goto('/')
    await expect(page.getByTestId('user-menu')).toBeVisible()
    const dialog = await fillSilenceUpToCreate(page, { alertname: 'R2ExpiredAlert', reason: 'R2 resume after expiry' })
    await expect(dialog.getByRole('button', { name: 'Preview' })).toBeEnabled({ timeout: 8_000 })

    // The token runs out unnoticed — the UI still believes it is logged in.
    await page.context().clearCookies()

    await previewAndCreate(dialog)

    const loginModal = page.getByRole('dialog', { name: 'Login', exact: true })
    await expect(loginModal.getByRole('heading', { name: 'Session expired' })).toBeVisible({ timeout: 8_000 })
    await logInThroughModal(page)

    await expect(dialog.getByText('Silence submitted')).toBeVisible({ timeout: 10_000 })
  })
})
