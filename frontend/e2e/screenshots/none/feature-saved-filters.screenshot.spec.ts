import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { manyAlerts } from '../../fixtures/alerts'
import type { Page } from '@playwright/test'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

const DEFAULT_USER_SETTINGS = {
  theme: 'dark' as const,
  timeFormat: 'relative' as const,
  defaultViewMode: 'card' as const,
  groupByLabel: 'severity',
  cardColumns: 'auto' as const,
  savedFilters: [
    { name: 'Prod critical', matchers: [{ name: 'severity', operator: '=', value: 'critical' }], isDefault: true },
    { name: 'Team payments', matchers: [{ name: 'severity', operator: '=', value: 'warning' }], isDefault: false },
    { name: 'Info only', matchers: [{ name: 'severity', operator: '=', value: 'info' }], isDefault: false },
  ],
  resolvedPageSize: 25,
  defaultSilenceDurationMinutes: 60,
  defaultCreatorName: '',
  claimAnimationEnabled: true,
  labelDisplay: { order: ['@cluster'], hidden: [] },
  labelColors: {},
}

function seedSavedFilters(page: Page) {
  return page.addInitScript(({ defaults }) => {
    const overrides = { savedFilters: defaults.savedFilters }
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: {
        ...defaults,
        overrides,
        globalDefaults: {},
        origin: 'local',
        syncState: 'idle',
        anonOverrides: overrides,
        userMirror: null,
      },
      version: 3,
    }))
  }, { defaults: DEFAULT_USER_SETTINGS })
}

/**
 * Screenshot: the saved-filters menu open with the default saved filter
 * applied — three saved filters (one marked default and active) below the toolbar.
 * Clipped to the union of the toolbar and the popover — the doc image is
 * about the feature, not the alert list beneath it.
 * Regenerate: make e2e-screenshot NAME=feature-saved-filters
 */
test('feature-saved-filters', async ({ page, am, jarvis }) => {
  await seedSavedFilters(page)
  await dismissNoAuthNotice(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, manyAlerts)

  // A bare URL applies the default saved filter ("Prod critical"), so the
  // menu shows an active filter with its checkmark rather than an idle list.
  await page.goto('/')
  await expect(page.getByTestId('saved-filters-menu-label')).toHaveText('Prod critical')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()
  await page.waitForTimeout(300)

  await page.getByTestId('saved-filters-menu').click()
  const popover = page.getByTestId('saved-filters-popover')
  await expect(popover).toBeVisible()
  // Let the chevron's rotate transition finish — otherwise it's captured mid-turn.
  await page.waitForTimeout(300)

  const toolbarBox = (await page.getByTestId('alerts-toolbar').boundingBox())!
  const popoverBox = (await popover.boundingBox())!
  const x = Math.min(toolbarBox.x, popoverBox.x)
  const y = Math.min(toolbarBox.y, popoverBox.y)
  const right = Math.max(toolbarBox.x + toolbarBox.width, popoverBox.x + popoverBox.width)
  const bottom = Math.max(toolbarBox.y + toolbarBox.height, popoverBox.y + popoverBox.height)

  await page.screenshot({
    path: `${DIR}/feature-saved-filters.png`,
    clip: { x: x - 8, y: y - 8, width: right - x + 16, height: bottom - y + 16 },
  })
})
