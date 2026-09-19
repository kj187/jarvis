import { test, expect } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'

const hint = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'About regex filters on resolved alerts' })

test('regex hint on the Resolved view appears only when a regex filter is set', async ({ page }) => {
  await dismissNoAuthNotice(page)

  // Resolved, no filter → nothing to explain, nothing shown.
  await page.goto('/?state=resolved')
  await expect(page.getByTitle('Resolved')).toBeVisible()
  await expect(hint(page)).toHaveCount(0)

  // An equality filter is not a regex either.
  await page.goto('/?state=resolved&filter=' + encodeURIComponent('{alertname="Kube"}'))
  await expect(page.getByTitle('Resolved')).toBeVisible()
  await expect(hint(page)).toHaveCount(0)

  // A regex filter → an (i) that explains the server-side syntax.
  await page.goto('/?state=resolved&filter=' + encodeURIComponent('{alertname=~"Kube.*"}'))
  await expect(hint(page)).toBeVisible()
  await hint(page).focus()
  await expect(page.getByRole('tooltip')).toContainText('lookaheads')

  // The Active view never shows it, regex or not.
  await page.goto('/?state=active&filter=' + encodeURIComponent('{alertname=~"Kube.*"}'))
  await expect(page.getByTitle('Active')).toBeVisible()
  await expect(hint(page)).toHaveCount(0)
})
