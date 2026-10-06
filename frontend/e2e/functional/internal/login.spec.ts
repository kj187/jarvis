import { request as pwRequest } from '@playwright/test'
import { test, expect, waitForActiveAlerts, expandComments, JARVIS_BASE_URL } from '../../support/fixtures'
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

  // Logout is final: the cookie the browser held no longer works afterwards.
  // Reuses this test's login — /auth/login is globally rate limited and the
  // internal suite sits right at that budget.
  const cookie = (await page.context().cookies()).find((c) => c.name === 'jarvis_session')
  expect(cookie).toBeTruthy()
  const statusWithOldCookie = async () => {
    const ctx = await pwRequest.newContext({ baseURL: JARVIS_BASE_URL })
    const res = await ctx.get('/auth/me', { headers: { cookie: `jarvis_session=${cookie!.value}` } })
    await ctx.dispose()
    return res.status()
  }
  expect(await statusWithOldCookie()).toBe(200)
  expect((await page.request.post('/auth/logout')).ok()).toBeTruthy()
  expect(await statusWithOldCookie()).toBe(401)
})

test('I2 write_protect mode shows internal username+password login modal on write attempt', async ({ page, am, jarvis }) => {
  await ensureInternalAdmin(page)
  // Do NOT log in — test as unauthenticated user in write_protect mode

  await am.fire([
    {
      labels: { alertname: 'I2LoginModalAlert', severity: 'warning', cluster: 'e2e' },
      annotations: { summary: 'I2 login modal test' },
    },
  ])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

  await page.goto('/?state=active')
  const firstCard = page.getByTestId('alert-card').first()
  await expect(firstCard).toBeVisible({ timeout: 10_000 })
  await firstCard.click()

  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()
  await expandComments(panel)

  // Type a comment body and click Send — this triggers LoginModal in write_protect mode
  const commentInput = page.getByTestId('detail-comment-input')
  await expect(commentInput).toBeVisible({ timeout: 8_000 })
  await commentInput.fill('I2 test comment')

  const sendBtn = page.getByTestId('detail-comment-submit')
  await expect(sendBtn).toBeEnabled()
  await sendBtn.click()

  // LoginModal should appear with internal credentials form
  const loginModal = page.getByRole('dialog', { name: 'Login', exact: true })
  await expect(loginModal).toBeVisible({ timeout: 8_000 })
  await expect(loginModal.getByPlaceholder('Username')).toBeVisible()
  await expect(loginModal.getByPlaceholder('Password')).toBeVisible()
  await expect(loginModal.getByRole('button', { name: 'Login' })).toBeVisible()
})

test('I4 write_protect retry flow: login via modal then write action completes', async ({ page, am, jarvis }) => {
  await ensureInternalAdmin(page)
  // Do NOT log in initially

  await am.fire([
    {
      labels: { alertname: 'I4RetryAlert', severity: 'critical', cluster: 'e2e' },
      annotations: { summary: 'I4 retry flow test' },
    },
  ])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

  await page.goto('/?state=active')
  const firstCard = page.getByTestId('alert-card').first()
  await expect(firstCard).toBeVisible({ timeout: 10_000 })
  await firstCard.click()

  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()
  await expandComments(panel)

  // Type comment and submit without auth → LoginModal appears
  const commentInput = page.getByTestId('detail-comment-input')
  await expect(commentInput).toBeVisible({ timeout: 8_000 })
  await commentInput.fill('I4 retry comment')
  await page.getByTestId('detail-comment-submit').click()

  const loginModal = page.getByRole('dialog', { name: 'Login', exact: true })
  await expect(loginModal).toBeVisible({ timeout: 8_000 })

  // Log in via the modal
  await loginModal.getByPlaceholder('Username').fill(INTERNAL_ADMIN.username)
  await loginModal.getByPlaceholder('Password').fill(INTERNAL_ADMIN.password)
  await loginModal.getByRole('button', { name: 'Login' }).click()

  // After login, the action retries automatically — comment should appear
  await expect(page.getByTestId('detail-comment-item').first()).toBeVisible({ timeout: 10_000 })
  const commentTexts = await page.getByTestId('detail-comment-item').allTextContents()
  expect(commentTexts.join('\n')).toContain('I4 retry comment')
})
