import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { manyAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshot: alerts card view, populated with a rich set so it doesn't look
 * empty. Uses fireWithHeatmapHistory so each card's firing sparkline isn't a
 * suspiciously empty row (it freezes the clock itself — see that helper's
 * docstring). Regenerate individually: make e2e-screenshot NAME=card-view
 */
test('card-view', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, manyAlerts)

  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/feature-card-view.png`, fullPage: true })
})

/**
 * Same shot in light theme, for the website's light mode — a dark screenshot on
 * a light page is the one place the docs site looks unfinished. Theme switch
 * follows feature-theme.screenshot.spec.ts.
 * Regenerate: make e2e-screenshot NAME=card-view-light
 */
test('card-view-light', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, manyAlerts)

  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()
  await page.getByTestId('user-menu').hover()
  await page.getByRole('button', { name: 'Light mode' }).click()
  await page.mouse.move(0, 0) // let the hover-close timer close the dropdown
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${DIR}/feature-card-view-light.png`, fullPage: true })
})
