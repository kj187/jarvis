import { test, expect } from '../../support/fixtures'
import { ensureInternalAdmin, loginInternal, INTERNAL_ADMIN } from '../../support/auth'

async function openAdminPanel(page: import('@playwright/test').Page) {
  await page.getByTestId('user-menu').click()
  await page.getByRole('button', { name: 'Admin' }).click()
  const dialog = page.getByRole('dialog', { name: 'User Management' })
  await expect(dialog).toBeVisible({ timeout: 8_000 })
  return dialog
}

test('I10 admin panel shows user list with current admin', async ({ page }) => {
  await ensureInternalAdmin(page)
  await loginInternal(page)

  await page.goto('/?state=active')
  const dialog = await openAdminPanel(page)

  // Admin should be listed in the table
  await expect(dialog.getByText(INTERNAL_ADMIN.username)).toBeVisible({ timeout: 8_000 })
  // Self row shows "(you)"
  await expect(dialog.getByText('(you)')).toBeVisible()
  // Table headers
  await expect(dialog.getByText('Username')).toBeVisible()
  await expect(dialog.getByText('Role')).toBeVisible()
})

test('I11 add-user validation rejects short password', async ({ page }) => {
  await ensureInternalAdmin(page)
  await loginInternal(page)

  await page.goto('/?state=active')
  const dialog = await openAdminPanel(page)

  // Fill username but short password (< 12 chars)
  await dialog.getByPlaceholder('Username').fill('newuser')
  await dialog.getByPlaceholder('Password (min 12 chars)').fill('short')
  await dialog.getByRole('button').filter({ has: page.locator('svg') }).last().click()

  // Validation error should appear
  await expect(dialog.getByText('Password must be at least 12 characters.')).toBeVisible({ timeout: 5_000 })
})

test('I12 role change updates a user role via the role select', async ({ page }) => {
  await ensureInternalAdmin(page)
  await loginInternal(page)

  // Create a second user first
  await page.request.post('/api/v1/admin/users', {
    headers: { 'Content-Type': 'application/json' },
    data: { username: 'i12-roleuser', password: 'i12-password-long', role: 'user' },
  })

  await page.goto('/?state=active')
  const dialog = await openAdminPanel(page)

  // Find the role select for i12-roleuser (not the self row)
  // Non-self rows have a role <select> with options user/admin
  const userRow = dialog.locator('tr').filter({ hasText: 'i12-roleuser' })
  await expect(userRow).toBeVisible({ timeout: 8_000 })

  const roleSelect = userRow.locator('select').first()
  await expect(roleSelect).toBeVisible()
  await roleSelect.selectOption('admin')

  // After update the select value should reflect admin
  await expect(roleSelect).toHaveValue('admin')
})

test('I13 delete user shows confirm state then removes user', async ({ page }) => {
  await ensureInternalAdmin(page)
  await loginInternal(page)

  // Create a user to delete
  await page.request.post('/api/v1/admin/users', {
    headers: { 'Content-Type': 'application/json' },
    data: { username: 'i13-deleteuser', password: 'i13-password-long', role: 'user' },
  })

  await page.goto('/?state=active')
  const dialog = await openAdminPanel(page)

  const userRow = dialog.locator('tr').filter({ hasText: 'i13-deleteuser' })
  await expect(userRow).toBeVisible({ timeout: 8_000 })

  // First click on delete icon → shows confirm state
  await userRow.getByRole('button', { name: /Delete i13-deleteuser/ }).click()

  // Confirm? + Yes/No buttons appear
  await expect(userRow.getByText('Confirm?')).toBeVisible()
  await expect(userRow.getByRole('button', { name: 'Yes' })).toBeVisible()
  await expect(userRow.getByRole('button', { name: 'No' })).toBeVisible()

  // Click Yes to confirm deletion
  await userRow.getByRole('button', { name: 'Yes' }).click()

  // User row should disappear
  await expect(dialog.locator('tr').filter({ hasText: 'i13-deleteuser' })).toHaveCount(0, { timeout: 8_000 })
})

test('I14 self-row has no delete button and non-editable role', async ({ page }) => {
  await ensureInternalAdmin(page)
  await loginInternal(page)

  await page.goto('/?state=active')
  const dialog = await openAdminPanel(page)

  const selfRow = dialog.locator('tr').filter({ hasText: '(you)' })
  await expect(selfRow).toBeVisible({ timeout: 8_000 })

  // No delete button on self row
  await expect(selfRow.getByRole('button', { name: /Delete/ })).toHaveCount(0)

  // Role is plain text, not a select
  await expect(selfRow.locator('select')).toHaveCount(0)
  await expect(selfRow.getByText('admin', { exact: true })).toBeVisible()
})
