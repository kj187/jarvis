import { test, expect, freezeClock, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

async function clearAllTemplates(baseURL: string): Promise<void> {
  const res = await fetch(`${baseURL}/api/v1/silence-templates`)
  if (!res.ok) return
  const templates: Array<{ id: string }> = await res.json()
  for (const t of templates) {
    await fetch(`${baseURL}/api/v1/silence-templates/${t.id}`, { method: 'DELETE' })
  }
}

/**
 * Screenshot: new template form expanded in the Templates tab.
 * Regenerate: make e2e-screenshot NAME=feature-silence-templates-form
 */
test('feature-silence-templates-form', async ({ page, jarvis }) => {
  await clearAllTemplates(JARVIS_BASE_URL)
  await freezeClock(page)
  await dismissNoAuthNotice(page)

  await jarvis.createTemplate('Production Maintenance', [
    { name: 'namespace', operator: '=', value: 'production' },
  ], 'Silence all production alerts during scheduled maintenance')

  await page.goto('/')
  await page.getByRole('button', { name: 'Create silence' }).click()
  await expect(page.getByText('Create Silence').first()).toBeVisible()

  await page.getByText('Templates').click()
  await expect(page.getByText('Saved Templates')).toBeVisible()

  await page.getByRole('button', { name: '+ New Template' }).click()
  await expect(page.getByText('New Template')).toBeVisible()
  await expect(page.getByPlaceholder('e.g., Prod Maintenance')).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/feature-silence-templates-form.png` })
})
