import { test, expect, JARVIS_BASE_URL, waitForActiveAlerts } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { manyAlerts } from '../../fixtures/alerts'
import type { Page } from '@playwright/test'

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Open settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('H1 settings panel opens via gear icon and shows Settings heading', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await page.goto('/')

  const dialog = await openSettings(page)

  await expect(dialog.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(dialog.getByText('Display')).toBeVisible()
  await expect(dialog.getByText('Silences')).toBeVisible()
})

test('H2 timeFormat toggle switches between Relative and Absolute', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await page.addInitScript(() => {
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: {
        theme: 'dark', timeFormat: 'relative', defaultViewMode: 'card',
        defaultFilters: [], resolvedPageSize: 25, defaultSilenceDurationMinutes: 60,
        defaultCreatorName: '', claimAnimationEnabled: true,
        groupByLabel: 'severity',
      },
      version: 0,
    }))
  })
  await page.goto('/')

  const dialog = await openSettings(page)

  const relativeBtn = dialog.getByRole('button', { name: 'Relative' })
  const absoluteBtn = dialog.getByRole('button', { name: 'Absolute' })
  await expect(relativeBtn).toBeVisible()
  await expect(absoluteBtn).toBeVisible()

  await absoluteBtn.click()

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('jarvis-user-settings')
    return raw ? JSON.parse(raw).state.timeFormat : null
  })
  expect(stored).toBe('absolute')

  await relativeBtn.click()
  const stored2 = await page.evaluate(() => {
    const raw = localStorage.getItem('jarvis-user-settings')
    return raw ? JSON.parse(raw).state.timeFormat : null
  })
  expect(stored2).toBe('relative')
})

test('H3 defaultViewMode card/list setting persists', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.addInitScript(() => {
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: {
        theme: 'dark', timeFormat: 'relative', defaultViewMode: 'card',
        defaultFilters: [], resolvedPageSize: 25, defaultSilenceDurationMinutes: 60,
        defaultCreatorName: '', claimAnimationEnabled: true,
        groupByLabel: 'severity',
      },
      version: 0,
    }))
  })
  await page.goto('/?state=active')

  const dialog = await openSettings(page)

  const listBtn = dialog.getByRole('button', { name: 'List' }).first()
  await listBtn.click()

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('jarvis-user-settings')
    return raw ? JSON.parse(raw).state.defaultViewMode : null
  })
  expect(stored).toBe('list')

  // Close settings
  await page.getByRole('button', { name: 'Close' }).click()
})

test('H5 defaultFilters adds a locked chip to the matcher bar', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.addInitScript(() => {
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: {
        theme: 'dark', timeFormat: 'relative', defaultViewMode: 'card',
        defaultFilters: [], resolvedPageSize: 25, defaultSilenceDurationMinutes: 60,
        defaultCreatorName: '', claimAnimationEnabled: true,
        groupByLabel: 'severity',
      },
      version: 0,
    }))
    localStorage.setItem('jarvis-ui', JSON.stringify({
      state: { activePage: 'alerts', filters: { state: 'active', search: '', labelMatchers: [] } },
      version: 0,
    }))
  })
  await page.goto('/?state=active')

  const dialog = await openSettings(page)

  // Add a default filter: severity = critical
  // The settings default filter section has ComboInput with placeholder="label" and "value"
  const labelField = dialog.locator('input[placeholder="label"]')
  await labelField.fill('severity')

  // Find the value input (there's only one with placeholder="value" in the settings dialog)
  const valueField = dialog.locator('input[placeholder="value"]')
  await valueField.fill('critical')
  // Do NOT press Enter here — that would submit and disable the button immediately.
  // Instead click the + button directly to add the filter.
  await dialog.getByRole('button', { name: 'Add default filter' }).click()

  // Chip text may be split across DOM spans — use the Remove button as proxy (unambiguous aria role)
  await expect(dialog.getByRole('button', { name: 'Remove filter severity=critical' })).toBeVisible({ timeout: 5_000 })

  // Close settings
  await page.getByRole('button', { name: 'Close' }).click()

  // Locked chip should now appear in the alerts filter bar
  await expect(page.locator('[title*="Settings"]').first()).toBeVisible({ timeout: 5_000 })
})

test('H6 defaultSilenceDurationMinutes select changes stored value', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await page.addInitScript(() => {
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: {
        theme: 'dark', timeFormat: 'relative', defaultViewMode: 'card',
        defaultFilters: [], resolvedPageSize: 25, defaultSilenceDurationMinutes: 60,
        defaultCreatorName: '', claimAnimationEnabled: true,
        groupByLabel: 'severity',
      },
      version: 0,
    }))
  })
  await page.goto('/')

  const dialog = await openSettings(page)

  // The silence duration select has option values like "60", "240", etc.
  // Find it by filtering for the "240" option (4 hours)
  const durationSelect = dialog.locator('select').filter({ has: page.locator('option[value="240"]') }).first()
  await expect(durationSelect).toBeVisible()
  await durationSelect.selectOption('240')

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('jarvis-user-settings')
    return raw ? JSON.parse(raw).state.defaultSilenceDurationMinutes : null
  })
  expect(stored).toBe(240)
})

test('H9 claimAnimationEnabled toggle switches state', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await page.addInitScript(() => {
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: {
        theme: 'dark', timeFormat: 'relative', defaultViewMode: 'card',
        defaultFilters: [], resolvedPageSize: 25, defaultSilenceDurationMinutes: 60,
        defaultCreatorName: '', claimAnimationEnabled: true,
        groupByLabel: 'severity',
      },
      version: 0,
    }))
  })
  await page.goto('/')

  const dialog = await openSettings(page)

  const switchBtn = dialog.locator('[role="switch"]').first()
  await expect(switchBtn).toBeVisible()

  const checkedBefore = await switchBtn.getAttribute('aria-checked')
  expect(checkedBefore).toBe('true')

  await switchBtn.click()

  const checkedAfter = await switchBtn.getAttribute('aria-checked')
  expect(checkedAfter).toBe('false')

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('jarvis-user-settings')
    return raw ? JSON.parse(raw).state.claimAnimationEnabled : null
  })
  expect(stored).toBe(false)
})

test('H10 reset to defaults shows confirm state then resets', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await page.addInitScript(() => {
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: {
        theme: 'dark', timeFormat: 'relative', defaultViewMode: 'card',
        defaultFilters: [], resolvedPageSize: 25, defaultSilenceDurationMinutes: 60,
        defaultCreatorName: '', claimAnimationEnabled: true,
        groupByLabel: 'severity',
      },
      version: 0,
    }))
  })
  await page.goto('/')

  const dialog = await openSettings(page)

  // Change a setting first
  await dialog.getByRole('button', { name: 'Absolute' }).click()

  const storedBefore = await page.evaluate(() => {
    const raw = localStorage.getItem('jarvis-user-settings')
    return raw ? JSON.parse(raw).state.timeFormat : null
  })
  expect(storedBefore).toBe('absolute')

  // First click shows confirm state
  await dialog.getByRole('button', { name: 'Reset to defaults' }).click()
  await expect(dialog.getByRole('button', { name: /Click again to confirm/ })).toBeVisible()

  // Second click resets
  await dialog.getByRole('button', { name: /Click again to confirm/ }).click()

  const storedAfter = await page.evaluate(() => {
    const raw = localStorage.getItem('jarvis-user-settings')
    return raw ? JSON.parse(raw).state.timeFormat : null
  })
  expect(storedAfter).toBe('relative')
})

test('H11 settings persist over reload (without addInitScript override)', async ({ page }) => {
  await dismissNoAuthNotice(page)

  // Set initial state via addInitScript (needed for noauth notice dismiss)
  // Then navigate and change setting
  await page.goto('/')
  // Wait for app to load
  await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible({ timeout: 10_000 })

  const dialog = await openSettings(page)

  // Change timeFormat to absolute
  await dialog.getByRole('button', { name: 'Absolute' }).click()

  const storedBefore = await page.evaluate(() => {
    const raw = localStorage.getItem('jarvis-user-settings')
    return raw ? JSON.parse(raw).state.timeFormat : null
  })
  expect(storedBefore).toBe('absolute')

  // Close settings
  await page.getByRole('button', { name: 'Close' }).click()

  // Navigate to a different URL and back (not reload, to avoid addInitScript re-run)
  await page.goto('/?state=active')
  await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible({ timeout: 10_000 })

  // Setting should still be absolute (persisted in localStorage by Zustand)
  const storedAfter = await page.evaluate(() => {
    const raw = localStorage.getItem('jarvis-user-settings')
    return raw ? JSON.parse(raw).state.timeFormat : null
  })
  expect(storedAfter).toBe('absolute')
})

test('H4 resolvedPageSize per-page buttons update localStorage', async ({ page, jarvis }) => {
  await dismissNoAuthNotice(page)

  // Seed a resolved alert so the resolved list view renders with data (Per page: only shown when alerts > 0)
  await jarvis.seedResolved([
    {
      fingerprint: 'h4resolvedfp001',
      alertname: 'H4ResolvedAlert',
      cluster: 'e2e',
      labels: { alertname: 'H4ResolvedAlert', severity: 'warning', cluster: 'e2e' },
      startsAt: new Date(Date.now() - 3_600_000).toISOString(),
      resolvedAt: new Date(Date.now() - 1_800_000).toISOString(),
    },
  ])

  await page.addInitScript(() => {
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: {
        theme: 'dark', timeFormat: 'relative', defaultViewMode: 'list',
        defaultFilters: [], resolvedPageSize: 25, defaultSilenceDurationMinutes: 60,
        defaultCreatorName: '', claimAnimationEnabled: true,
        groupByLabel: 'severity',
      },
      version: 0,
    }))
  })

  await page.goto('/?state=resolved&view=list')

  // Wait for the Per page: label to be visible (appears when resolved alerts are present)
  await expect(page.getByText('Per page:').first()).toBeVisible({ timeout: 10_000 })

  // Click the "10" per-page button
  await page.getByRole('button', { name: '10', exact: true }).click()

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('jarvis-user-settings')
    return raw ? JSON.parse(raw).state.resolvedPageSize : null
  })
  expect(stored).toBe(10)

  // Also verify clicking "50" updates the value
  await page.getByRole('button', { name: '50', exact: true }).click()
  const stored2 = await page.evaluate(() => {
    const raw = localStorage.getItem('jarvis-user-settings')
    return raw ? JSON.parse(raw).state.resolvedPageSize : null
  })
  expect(stored2).toBe(50)
})

test('H7 defaultCreatorName from settings pre-fills the author in the silence form', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await page.addInitScript(() => {
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: {
        theme: 'dark', timeFormat: 'relative', defaultViewMode: 'card',
        defaultFilters: [], resolvedPageSize: 25, defaultSilenceDurationMinutes: 60,
        defaultCreatorName: 'h7-settings-user', claimAnimationEnabled: true,
        groupByLabel: 'severity',
      },
      version: 0,
    }))
    // Ensure the per-session username key is NOT set so it falls back to settings
    localStorage.removeItem('jarvis-username')
  })
  await page.goto('/')

  const dialog = page.getByRole('dialog', { name: 'Create silence' })
  await page.getByRole('button', { name: 'Create silence' }).first().click()
  await expect(dialog).toBeVisible({ timeout: 5_000 })

  // Author field should be pre-filled from settings.defaultCreatorName
  const authorInput = dialog.getByPlaceholder('Your name')
  await expect(authorInput).toHaveValue('h7-settings-user')
})
