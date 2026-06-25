import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'

async function clearAllTemplates(baseURL: string): Promise<void> {
  const res = await fetch(`${baseURL}/api/v1/silence-templates`)
  if (!res.ok) return
  const templates = (await res.json()) as Array<{ id: string }>
  for (const template of templates) {
    await fetch(`${baseURL}/api/v1/silence-templates/${template.id}`, { method: 'DELETE' })
  }
}

test('F1 silence form opens and closes via Cancel', async ({ page }) => {
  await dismissNoAuthNotice(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Create silence' }).first().click()
  await expect(page.getByText('Create Silence').first()).toBeVisible()
  await expect(page.getByPlaceholder('Reason for the silence…')).toBeVisible()

  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByPlaceholder('Reason for the silence…')).toHaveCount(0)
})

test('F1 silence form closes via Close button and Escape', async ({ page }) => {
  await dismissNoAuthNotice(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Create silence' }).first().click()
  await expect(page.getByPlaceholder('Reason for the silence…')).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByPlaceholder('Reason for the silence…')).toHaveCount(0)

  await page.getByRole('button', { name: 'Create silence' }).first().click()
  await expect(page.getByPlaceholder('Reason for the silence…')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByPlaceholder('Reason for the silence…')).toHaveCount(0)
})

test('F1 silence form closes via backdrop click', async ({ page }) => {
  await dismissNoAuthNotice(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Create silence' }).first().click()
  await expect(page.getByPlaceholder('Reason for the silence…')).toBeVisible()

  await page.locator('div.fixed.inset-0.z-40.bg-black\\/50').click({ position: { x: 10, y: 10 } })
  await expect(page.getByPlaceholder('Reason for the silence…')).toHaveCount(0)
})

test('F14 reason is required before preview is enabled', async ({ page }) => {
  await dismissNoAuthNotice(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Create silence' }).first().click()
  await expect(page.getByText('Create Silence').first()).toBeVisible()

  await page.getByPlaceholder('Your name').fill('e2e-user')

  const previewButton = page.getByRole('button', { name: 'Preview' })
  await expect(previewButton).toBeDisabled()

  await page.getByPlaceholder('Reason for the silence…').fill('Planned maintenance')
  await expect(previewButton).toBeEnabled()
})

test('F2 submit requires at least one selected cluster', async ({ page }) => {
  await dismissNoAuthNotice(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Create silence' }).first().click()
  await expect(page.getByText('Create Silence').first()).toBeVisible()

  await page.getByPlaceholder('Your name').fill('e2e-user')
  await page.getByPlaceholder('Reason for the silence…').fill('Planned maintenance')

  const previewButton = page.getByRole('button', { name: 'Preview' })
  await expect(previewButton).toBeEnabled()

  const clusterButton = page.getByRole('button', { name: 'e2e' }).first()
  await clusterButton.click()
  await expect(previewButton).toBeDisabled()

  await clusterButton.click()
  await expect(previewButton).toBeEnabled()
})

test('G4 templates tab shows empty state when no templates exist', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await clearAllTemplates(JARVIS_BASE_URL)

  await page.goto('/')
  await page.getByRole('button', { name: 'Create silence' }).first().click()
  await expect(page.getByText('Create Silence').first()).toBeVisible()

  await page.getByRole('button', { name: 'Templates' }).click()
  await expect(page.getByText('Saved Templates')).toBeVisible()
  await expect(page.getByText('No templates yet.')).toBeVisible()
})

test('G5 creates a silence template via templates tab', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await clearAllTemplates(JARVIS_BASE_URL)

  await page.goto('/')
  await page.getByRole('button', { name: 'Create silence' }).first().click()
  await expect(page.getByText('Create Silence').first()).toBeVisible()

  await page.getByRole('button', { name: 'Templates' }).click()
  await page.getByRole('button', { name: '+ New Template' }).click()

  await page.getByPlaceholder('e.g., Prod Maintenance').fill('E2E Template')
  await page.getByRole('button', { name: '+ Add Matcher' }).click()
  await page.getByPlaceholder('Label name').fill('namespace')
  await page.getByPlaceholder('Value').fill('production')
  await page.getByPlaceholder('e.g., Scheduled maintenance window').fill('Template reason')

  await page.getByRole('button', { name: 'Save Template' }).click()
  await expect(page.getByText('E2E Template')).toBeVisible()
  await expect(page.getByText('1 matcher')).toBeVisible()
})

test('G6 applying a template pre-fills matchers and reason', async ({ page, jarvis }) => {
  await dismissNoAuthNotice(page)
  await clearAllTemplates(JARVIS_BASE_URL)

  await jarvis.createTemplate(
    'Maintenance Window',
    [{ name: 'severity', operator: '=', value: 'warning' }],
    'Planned maintenance',
  )

  await page.goto('/')
  await page.getByRole('button', { name: 'Create silence' }).first().click()
  await expect(page.getByText('Create Silence').first()).toBeVisible()

  await page.selectOption('select', { label: 'Maintenance Window' })
  await expect(page.getByText('1 matcher loaded from template')).toBeVisible()
  await expect(page.getByPlaceholder('Reason for the silence…')).toHaveValue('Planned maintenance')
})

test('G7 edits an existing template', async ({ page, jarvis }) => {
  await dismissNoAuthNotice(page)
  await clearAllTemplates(JARVIS_BASE_URL)

  await jarvis.createTemplate(
    'Original Template',
    [{ name: 'severity', operator: '=', value: 'warning' }],
    'Original reason',
  )

  await page.goto('/')
  await page.getByRole('button', { name: 'Create silence' }).first().click()
  await page.getByRole('button', { name: 'Templates' }).click()

  const row = page
    .getByText('Original Template', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"bg-muted/50")][1]')
  await row.getByRole('button').first().click()

  await page.getByPlaceholder('e.g., Prod Maintenance').fill('Updated Template')
  await page.getByRole('button', { name: 'Update Template' }).click()

  await expect(page.getByText('Updated Template')).toBeVisible()
  await expect(page.getByText('Original Template')).toHaveCount(0)
})

test('G8 deletes a template', async ({ page, jarvis }) => {
  await dismissNoAuthNotice(page)
  await clearAllTemplates(JARVIS_BASE_URL)

  await jarvis.createTemplate(
    'Delete Me',
    [{ name: 'alertname', operator: '=', value: 'KubePodCrashLooping' }],
    'Temporary',
  )

  await page.goto('/')
  await page.getByRole('button', { name: 'Create silence' }).first().click()
  await page.getByRole('button', { name: 'Templates' }).click()
  await expect(page.getByText('Delete Me')).toBeVisible()

  page.once('dialog', (dialog) => dialog.accept())
  const row = page
    .getByText('Delete Me', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"bg-muted/50")][1]')
  await row.getByRole('button').nth(1).click()

  await expect(page.getByText('Delete Me')).toHaveCount(0)
})
