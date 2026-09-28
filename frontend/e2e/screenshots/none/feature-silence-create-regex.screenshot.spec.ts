import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: create silence form with a `=~` matcher in Regex mode (Values | Regex
 * switch) and the live "affected alerts" preview for the pattern.
 * Regenerate: make e2e-screenshot NAME=feature-silence-create-regex
 */
test('feature-silence-create-regex', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, manyAlerts)

  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()

  await page.getByRole('button', { name: 'Create silence' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Create silence' })
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: 'label' }).first().click()
  const search = dialog.getByPlaceholder('Search…').first()
  await search.fill('alertname')
  await search.press('Enter')

  await dialog.locator('select').first().selectOption('=~')

  // Regex syntax typed into the Values field switches the row to Regex mode.
  const valueInput = dialog.locator('.flex.min-h-8 input').first()
  await valueInput.fill('Kube.*')
  await valueInput.press('Enter')
  await expect(
    dialog.getByRole('group', { name: 'Value mode' }).getByRole('button', { name: 'Regex' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByLabel('Regex pattern')).toHaveValue('Kube.*')
  await page.waitForTimeout(500)

  await page.screenshot({ path: `${DIR}/feature-silence-create-regex.png` })
})
