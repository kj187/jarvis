import { test, expect } from '../../support/fixtures'

// The stack's admin may already exist, so /auth/info and POST /setup are
// stubbed: this covers only what the setup page does with a required token.
test('setup page asks for the setup token and reports a wrong one', async ({ page }) => {
  await page.route('**/auth/info', (route) =>
    route.fulfill({
      json: { mode: 'internal', loginUrl: '/login', setupRequired: true, setupTokenRequired: true },
    }),
  )
  let posted: Record<string, string> | null = null
  await page.route('**/setup', (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    posted = route.request().postDataJSON()
    return route.fulfill({ status: 401, json: { error: 'invalid setup token' } })
  })

  await page.goto('/setup')
  await expect(page.getByText('Initial setup')).toBeVisible()

  const submit = page.getByRole('button', { name: 'Create admin account' })
  await page.locator('#setup-username').fill('admin')
  await page.locator('#setup-password').fill('a-long-enough-password')
  await page.locator('#setup-confirm').fill('a-long-enough-password')
  await expect(submit).toBeDisabled()

  await page.locator('#setup-token').fill('wrong-token')
  await submit.click()

  await expect(page.getByText('The setup token is not correct.')).toBeVisible()
  expect(posted).toMatchObject({ username: 'admin', setupToken: 'wrong-token' })
})

test('setup page hides the token field when none is required', async ({ page }) => {
  await page.route('**/auth/info', (route) =>
    route.fulfill({ json: { mode: 'internal', loginUrl: '/login', setupRequired: true, setupTokenRequired: false } }),
  )
  await page.goto('/setup')
  await expect(page.getByText('Initial setup')).toBeVisible()
  await expect(page.locator('#setup-token')).toHaveCount(0)
})
