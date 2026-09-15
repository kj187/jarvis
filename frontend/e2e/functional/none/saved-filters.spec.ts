import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { kubernetesAlerts } from '../../fixtures/alerts'
import type { Page } from '@playwright/test'

/**
 * Catalog: saved filters (replaces the removed "Default Filter" Settings
 * section — see docs/features.md "Saved filters"). `kubernetesAlerts`
 * (fixtures/alerts.ts) has both `severity: critical` and `severity: warning`
 * entries, which is enough to build two distinguishable saved filters
 * without a dedicated fixture.
 */

const DEFAULT_USER_SETTINGS = {
  theme: 'dark' as const,
  timeFormat: 'relative' as const,
  defaultViewMode: 'card' as const,
  groupByLabel: 'severity',
  cardColumns: 'auto' as const,
  savedFilters: [] as unknown[],
  resolvedPageSize: 25,
  defaultSilenceDurationMinutes: 60,
  defaultCreatorName: '',
  claimAnimationEnabled: true,
  labelDisplay: { order: ['@cluster'], hidden: [] },
  labelColors: {},
}

/** Seeds `jarvis-user-settings` as a realistic v3 (current) persisted state —
    the shape `useSettingsStore` itself writes, with `savedFilters` as the
    only override so `useSettingsSync`'s local-mode resolve reads it back
    unchanged. */
function seedSavedFilters(page: Page, savedFilters: unknown[] = []) {
  return page.addInitScript(({ defaults, savedFilters }) => {
    const overrides = savedFilters.length > 0 ? { savedFilters } : {}
    const resolved = { ...defaults, ...overrides }
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: {
        ...resolved,
        overrides,
        globalDefaults: {},
        origin: 'local',
        syncState: 'idle',
        anonOverrides: overrides,
        userMirror: null,
      },
      version: 3,
    }))
  }, { defaults: DEFAULT_USER_SETTINGS, savedFilters })
}

function seedUIFilters(page: Page, labelMatchers: unknown[] = []) {
  return page.addInitScript(({ labelMatchers }) => {
    localStorage.setItem('jarvis-ui', JSON.stringify({
      state: {
        activePage: 'alerts',
        filters: { state: 'active', search: '', labelMatchers },
      },
      version: 0,
    }))
  }, { labelMatchers })
}

async function openSettings(page: Page) {
  await page.getByTestId('user-menu').click()
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  return dialog
}

function menuButton(page: Page) {
  return page.getByTestId('saved-filters-menu')
}

async function openMenu(page: Page) {
  await menuButton(page).click()
  const popover = page.getByTestId('saved-filters-popover')
  await expect(popover).toBeVisible()
  return popover
}

async function readSettings(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('jarvis-user-settings') ?? '{}').state)
}

test('K1 saving the current filter creates a saved filter that shows as active', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)
  await seedSavedFilters(page)
  await seedUIFilters(page)

  await page.goto(`/?state=active&filter=${encodeURIComponent('{severity="critical"}')}`)

  const popover = await openMenu(page)
  await popover.getByPlaceholder('Name this filter').fill('Critical')
  await popover.getByRole('button', { name: 'Save' }).click()

  await expect(popover.getByRole('button', { name: 'Apply saved filter Critical' })).toBeVisible()
  await expect(menuButton(page)).toContainText('Critical')

  const stored = await readSettings(page)
  const saved = stored.savedFilters as Array<{ name: string }>
  expect(saved.map((f) => f.name)).toEqual(['Critical'])
})

test('K2 applying a saved filter replaces the current matchers but leaves search untouched', async ({ page, am, jarvis }) => {
  // Note: the alert detail panel is a full-viewport modal (Sheet, pre-existing
  // behavior unrelated to this feature) whose backdrop blocks every other
  // toolbar interaction while it's open — a saved filter can only be applied
  // with no alert selected. `setLabelMatchers` (uiStore.ts) only ever touches
  // `filters.labelMatchers`, so it cannot itself clear a selection; that's
  // covered at the implementation level, not exercised here via click-through.
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)
  await seedSavedFilters(page, [
    { name: 'Critical', matchers: [{ name: 'severity', operator: '=', value: 'critical' }], isDefault: false },
  ])
  // "e2e" matches every kubernetesAlerts entry's `cluster` label, so the
  // search narrows nothing here — it only has to survive untouched.
  await page.goto(`/?state=active&q=e2e&filter=${encodeURIComponent('{severity="warning"}')}`)
  await expect(page.getByTestId('alert-card').first()).toBeVisible()

  await openMenu(page)
  await page.getByRole('button', { name: 'Apply saved filter Critical' }).click()

  await expect.poll(() => new URL(page.url()).searchParams.get('filter') ?? '').toContain('severity="critical"')
  await expect.poll(() => new URL(page.url()).searchParams.get('filter') ?? '').not.toContain('severity="warning"')
  expect(new URL(page.url()).searchParams.get('q')).toBe('e2e')
})

test('K3 a changed saved filter keeps its name on the button, shows the unsaved dot and offers "Save changes"', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)
  await seedSavedFilters(page, [
    { name: 'Critical', matchers: [{ name: 'severity', operator: '=', value: 'critical' }], isDefault: false },
  ])
  await page.goto(`/?state=active&filter=${encodeURIComponent('{severity="critical"}')}`)

  await expect(menuButton(page)).toContainText('Critical')
  await expect(page.getByTestId('saved-filters-unsaved-dot')).toHaveCount(0)

  // Change the current filter away from the saved one.
  await page.getByRole('button', { name: /^Remove filter/ }).first().click()
  await page.getByRole('button', { name: 'Add filter' }).click()
  const labelInput = page.getByLabel('Label name').last()
  const valueInput = page.getByLabel('Label value').last()
  await labelInput.fill('severity')
  await labelInput.press('Enter')
  await valueInput.fill('warning')
  await valueInput.press('Enter')

  // The CLOSED button still names the filter it came from and shows the
  // unsaved dot — no need to open the popover to notice the change.
  await expect(page.getByTestId('saved-filters-menu-label')).toHaveText('Critical')
  await expect(page.getByTestId('saved-filters-unsaved-dot')).toBeVisible()
  await expect(menuButton(page)).toHaveAttribute('title', /changed, not saved yet/)

  const popover = await openMenu(page)
  await expect(popover.getByText('modified')).toBeVisible()
  // Other rows don't offer a one-click overwrite while a base is known.
  await expect(popover.getByRole('button', { name: /^Update .* with current filter$/ })).toHaveCount(0)
  await popover.getByRole('button', { name: 'Save changes to Critical' }).click()

  await expect(menuButton(page)).toContainText('Critical')
  await expect(page.getByTestId('saved-filters-unsaved-dot')).toHaveCount(0)
  const stored = await readSettings(page)
  const saved = stored.savedFilters as Array<{ name: string; matchers: Array<{ value: string }> }>
  expect(saved[0].matchers).toEqual([{ name: 'severity', operator: '=', value: 'warning' }])
})

test('K4 renaming validates uniqueness and applies a valid new name', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await seedSavedFilters(page, [
    { name: 'Critical', matchers: [{ name: 'severity', operator: '=', value: 'critical' }], isDefault: false },
    { name: 'Warnings', matchers: [{ name: 'severity', operator: '=', value: 'warning' }], isDefault: false },
  ])
  await page.goto('/?state=active')

  const popover = await openMenu(page)
  await popover.getByRole('button', { name: 'Rename Critical' }).click()
  const renameInput = popover.getByLabel('Rename Critical')
  // The input opens with the current name selected, so typing replaces it.
  await renameInput.fill('warnings')
  // A duplicate is flagged while typing, and the confirm button refuses it.
  await expect(popover.getByText('A saved filter with this name already exists.')).toBeVisible()
  await expect(popover.getByRole('button', { name: 'Confirm rename' })).toBeDisabled()

  // Escape cancels the rename without closing the popover.
  await renameInput.press('Escape')
  await expect(popover).toBeVisible()
  await expect(popover.getByRole('button', { name: 'Apply saved filter Critical' })).toBeVisible()

  await popover.getByRole('button', { name: 'Rename Critical' }).click()
  await popover.getByLabel('Rename Critical').fill('Critical alerts')
  await popover.getByLabel('Rename Critical').press('Enter')
  await expect(popover.getByRole('button', { name: 'Apply saved filter Critical alerts' })).toBeVisible()
})

test('K5 deleting requires a second confirming click and leaves the current filter untouched', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)
  await seedSavedFilters(page, [
    { name: 'Critical', matchers: [{ name: 'severity', operator: '=', value: 'critical' }], isDefault: false },
  ])
  await page.goto(`/?state=active&filter=${encodeURIComponent('{severity="critical"}')}`)

  const popover = await openMenu(page)
  await popover.getByRole('button', { name: 'Delete Critical' }).click()
  await expect(popover.getByRole('button', { name: 'Click again to delete Critical' })).toBeVisible()
  await popover.getByRole('button', { name: 'Click again to delete Critical' }).click()

  await expect(popover.getByRole('button', { name: 'Apply saved filter Critical' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Remove filter/ }).first()).toBeVisible()
})

test('K6 the default saved filter is applied only when the URL has no alert-view params', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)
  await seedSavedFilters(page, [
    { name: 'Critical', matchers: [{ name: 'severity', operator: '=', value: 'critical' }], isDefault: true },
  ])
  await seedUIFilters(page)

  await page.goto('/')
  await expect.poll(() => new URL(page.url()).searchParams.get('filter') ?? '').toContain('severity="critical"')

  await seedSavedFilters(page, [
    { name: 'Critical', matchers: [{ name: 'severity', operator: '=', value: 'critical' }], isDefault: true },
  ])
  await seedUIFilters(page)
  await page.goto('/?state=active')
  await expect.poll(() => new URL(page.url()).searchParams.has('filter')).toBe(false)

  await seedSavedFilters(page, [
    { name: 'Critical', matchers: [{ name: 'severity', operator: '=', value: 'critical' }], isDefault: true },
  ])
  await page.goto(`/?state=active&filter=${encodeURIComponent('{severity="warning"}')}`)
  await expect.poll(() => new URL(page.url()).searchParams.get('filter')).toBe('{severity="warning"}')
})

test('K7 default-filter chips are ordinary chips: removable, and the removal survives a reload', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)
  await seedSavedFilters(page, [
    { name: 'Critical', matchers: [{ name: 'severity', operator: '=', value: 'critical' }], isDefault: true },
  ])
  await seedUIFilters(page)
  await page.goto('/')

  await expect.poll(() => new URL(page.url()).searchParams.get('filter') ?? '').toContain('severity="critical"')
  await page.getByRole('button', { name: /^Remove filter/ }).first().click()
  await expect(page.getByRole('button', { name: /^Remove filter/ })).toHaveCount(0)
  await expect.poll(() => new URL(page.url()).searchParams.has('filter')).toBe(false)

  await page.reload()
  await expect(page.getByRole('button', { name: 'Add filter' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Remove filter/ })).toHaveCount(0)
})

test('K8 a legacy defaultFilters blob is migrated into a default saved filter on load', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.addInitScript(() => {
    const legacyFilters = [{ name: 'severity', operator: '=', value: 'critical' }]
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: {
        theme: 'dark',
        timeFormat: 'relative',
        defaultViewMode: 'card',
        defaultFilters: legacyFilters,
        resolvedPageSize: 25,
        defaultSilenceDurationMinutes: 60,
        defaultCreatorName: '',
        claimAnimationEnabled: true,
        overrides: { defaultFilters: legacyFilters },
        globalDefaults: {},
        origin: 'local',
        syncState: 'idle',
        anonOverrides: { defaultFilters: legacyFilters },
        userMirror: null,
      },
      version: 2,
    }))
  })
  await seedUIFilters(page)
  await page.goto('/')

  await expect.poll(() => new URL(page.url()).searchParams.get('filter') ?? '').toContain('severity="critical"')

  const popover = await openMenu(page)
  await expect(popover.getByRole('button', { name: 'Apply saved filter Default' })).toBeVisible()
  await expect(popover.getByRole('button', { name: 'Unset Default as default' })).toBeVisible()

  const raw = await page.evaluate(() => localStorage.getItem('jarvis-user-settings'))
  expect(raw).not.toContain('defaultFilters')
})

test('K9 the save row is replaced by a hint when the current filter is empty or already saved', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)
  await seedSavedFilters(page, [
    { name: 'Critical', matchers: [{ name: 'severity', operator: '=', value: 'critical' }], isDefault: false },
  ])
  await seedUIFilters(page)
  await page.goto('/?state=active')

  // An empty current filter is not "unsaved" — nothing to save yet, so no dot.
  await expect(page.getByTestId('saved-filters-unsaved-dot')).toHaveCount(0)
  let popover = await openMenu(page)
  await expect(popover.getByText('Add filter chips to save them as a filter.')).toBeVisible()
  await expect(popover.getByPlaceholder('Name this filter')).toHaveCount(0)
  await menuButton(page).click()

  await page.goto(`/?state=active&filter=${encodeURIComponent('{severity="critical"}')}`)
  popover = await openMenu(page)
  await expect(popover.getByText('Current filter is saved as "Critical".')).toBeVisible()
  await expect(popover.getByPlaceholder('Name this filter')).toHaveCount(0)
})

test('K10 "Reset all settings" clears saved filters', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await seedSavedFilters(page, [
    { name: 'Critical', matchers: [{ name: 'severity', operator: '=', value: 'critical' }], isDefault: false },
  ])
  await page.goto('/?state=active')

  const dialog = await openSettings(page)
  await dialog.getByRole('button', { name: 'Reset all settings' }).click()
  await dialog.getByRole('button', { name: /Click again to confirm/ }).click()
  await page.getByRole('button', { name: 'Close' }).click()

  const popover = await openMenu(page)
  await expect(popover.getByText('No saved filters yet.')).toBeVisible()
})

test('K11 the unsaved indicator also appears for a filter built from scratch, without ever loading a saved one', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)
  await seedSavedFilters(page)
  await seedUIFilters(page)
  await page.goto('/?state=active')

  await expect(page.getByTestId('saved-filters-unsaved-dot')).toHaveCount(0)

  await page.getByRole('button', { name: 'Add filter' }).click()
  const labelInput = page.getByLabel('Label name').last()
  const valueInput = page.getByLabel('Label value').last()
  await labelInput.fill('severity')
  await labelInput.press('Enter')
  await valueInput.fill('critical')
  await valueInput.press('Enter')

  await expect(page.getByTestId('saved-filters-unsaved-dot')).toBeVisible()
  await expect(menuButton(page)).toHaveAttribute('title', /isn't saved yet/)
})

test('K12 "modified" survives a reload; re-applying the base discards the changes, "save as new" works via Enter', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)
  await seedSavedFilters(page, [
    { name: 'Critical', matchers: [{ name: 'severity', operator: '=', value: 'critical' }], isDefault: false },
  ])
  await page.goto(`/?state=active&filter=${encodeURIComponent('{severity="critical"}')}`)
  await expect(page.getByTestId('saved-filters-menu-label')).toHaveText('Critical')

  // Change the filter, then reload — the change (URL) and its base (tab session) both survive.
  await page.getByRole('button', { name: 'Add filter' }).click()
  await page.getByLabel('Label name').last().fill('team')
  await page.getByLabel('Label name').last().press('Enter')
  await page.getByLabel('Label value').last().fill('platform')
  await page.getByLabel('Label value').last().press('Enter')
  await expect(page.getByTestId('saved-filters-unsaved-dot')).toBeVisible()

  await page.reload()
  await expect(page.getByTestId('saved-filters-menu-label')).toHaveText('Critical')
  await expect(page.getByTestId('saved-filters-unsaved-dot')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Remove filter/ })).toHaveCount(2)

  // "Save as new" via Enter keeps "Critical" untouched and makes the new filter active.
  let popover = await openMenu(page)
  await popover.getByLabel('Saved filter name').fill('Critical platform')
  await popover.getByLabel('Saved filter name').press('Enter')
  await expect(page.getByTestId('saved-filters-menu-label')).toHaveText('Critical platform')
  await expect(page.getByTestId('saved-filters-unsaved-dot')).toHaveCount(0)
  const stored = await readSettings(page)
  const saved = stored.savedFilters as Array<{ name: string; matchers: unknown[] }>
  expect(saved.find((f) => f.name === 'Critical')?.matchers).toEqual([{ name: 'severity', operator: '=', value: 'critical' }])
  expect(saved.find((f) => f.name === 'Critical platform')?.matchers).toHaveLength(2)

  // Re-applying a filter replaces the chips again (the way to discard changes).
  await menuButton(page).click()
  popover = await openMenu(page)
  await popover.getByRole('button', { name: 'Apply saved filter Critical', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Remove filter/ })).toHaveCount(1)
  await expect(page.getByTestId('saved-filters-menu-label')).toHaveText('Critical')
})

test('K13 without a known base, overwriting another saved filter needs a second click', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)
  await seedSavedFilters(page, [
    { name: 'Warnings', matchers: [{ name: 'severity', operator: '=', value: 'warning' }], isDefault: false },
  ])
  await page.goto(`/?state=active&filter=${encodeURIComponent('{severity="critical"}')}`)
  // No saved filter applied → compact icon-only button, no label.
  await expect(page.getByTestId('saved-filters-menu-label')).toHaveCount(0)

  const popover = await openMenu(page)
  await popover.getByRole('button', { name: 'Update Warnings with current filter' }).click()
  // First click only arms it — nothing is written yet.
  let stored = await readSettings(page)
  expect((stored.savedFilters as Array<{ matchers: Array<{ value: string }> }>)[0].matchers[0].value).toBe('warning')

  await popover.getByRole('button', { name: 'Click again to overwrite Warnings' }).click()
  await expect(page.getByTestId('saved-filters-menu-label')).toHaveText('Warnings')
  stored = await readSettings(page)
  expect((stored.savedFilters as Array<{ matchers: Array<{ value: string }> }>)[0].matchers[0].value).toBe('critical')
})
