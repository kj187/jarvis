import { test, expect, JARVIS_BASE_URL, waitForActiveAlerts } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { manyAlerts, kubernetesAlerts } from '../../fixtures/alerts'
import type { Page } from '@playwright/test'

async function openSettings(page: Page) {
  await page.getByTestId('user-menu').click()
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('H1 settings panel opens via user menu and shows Settings heading', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await page.goto('/')

  const dialog = await openSettings(page)

  await expect(dialog.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(dialog.getByText('Display')).toBeVisible()
  await expect(dialog.getByText('Silences')).toBeVisible()
})

test('H12 settings open state survives a reload via the URL', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await page.goto('/?state=active')

  const dialog = await openSettings(page)
  await expect.poll(() => new URL(page.url()).searchParams.get('settings')).toBe('open')
  await expect.poll(() => new URL(page.url()).searchParams.get('state')).toBe('active')

  await page.reload()
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect.poll(() => new URL(page.url()).searchParams.has('settings')).toBe(false)
  await expect.poll(() => new URL(page.url()).searchParams.get('state')).toBe('active')
})

test('H2 timeFormat toggle switches between Relative and Absolute', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await page.addInitScript(() => {
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: {
        theme: 'dark', timeFormat: 'relative', defaultViewMode: 'card',
        resolvedPageSize: 25, defaultSilenceDurationMinutes: 60,
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
        resolvedPageSize: 25, defaultSilenceDurationMinutes: 60,
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

test('H6 defaultSilenceDurationMinutes select changes stored value', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await page.addInitScript(() => {
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: {
        theme: 'dark', timeFormat: 'relative', defaultViewMode: 'card',
        resolvedPageSize: 25, defaultSilenceDurationMinutes: 60,
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
        resolvedPageSize: 25, defaultSilenceDurationMinutes: 60,
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
        resolvedPageSize: 25, defaultSilenceDurationMinutes: 60,
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
  await dialog.getByRole('button', { name: 'Reset all settings' }).click()
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
  await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 10_000 })

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
  await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 10_000 })

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
        resolvedPageSize: 25, defaultSilenceDurationMinutes: 60,
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
        resolvedPageSize: 25, defaultSilenceDurationMinutes: 60,
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

/** Durations offered by the open Fast-Silence menu of the first alert, in order. */
async function fastSilenceOptions(page: Page): Promise<string[]> {
  await page.getByLabel('Silence options for this alert').first().hover()
  const options = page.getByTestId('alert-ack-option')
  await expect(options.first()).toBeVisible()
  return options.allInnerTexts()
}

test('H13 silence durations edited in settings show up in the Fast-Silence menu', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)
  await page.goto('/?state=active')

  expect(await fastSilenceOptions(page)).toEqual(['5m', '10m', '15m', '30m', '1h', '4h', '1d', '1w'])
  await page.keyboard.press('Escape')

  const dialog = await openSettings(page)
  const editor = dialog.getByTestId('duration-list-editor').first()
  await editor.getByRole('button', { name: 'Remove 5m' }).click()
  await editor.getByRole('textbox', { name: /Add duration to Silence durations/ }).fill('30d')
  await page.keyboard.press('Enter')
  await expect(editor.getByRole('button', { name: 'Remove 30d' })).toBeVisible()

  // Only the user's deviation from the defaults is stored, as minutes.
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('jarvis-user-settings')
    return raw ? JSON.parse(raw).state.overrides.silenceDurations : null
  })
  expect(stored).toEqual([10, 15, 30, 60, 240, 1440, 10080, 43200])

  await dialog.getByRole('button', { name: 'Close' }).click()
  expect(await fastSilenceOptions(page)).toEqual(['10m', '15m', '30m', '1h', '4h', '1d', '1w', '30d'])

  // Reset restores the default list and drops the override again.
  await page.keyboard.press('Escape')
  await openSettings(page)
  await editor.getByRole('button', { name: 'Reset' }).click()
  await expect(editor.getByRole('button', { name: 'Remove 5m' })).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Reset' })).toHaveCount(0)
})

test('H14 an invalid duration is rejected with a hint and the list stays unchanged', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await page.goto('/')

  const dialog = await openSettings(page)
  const editor = dialog.getByTestId('duration-list-editor').first()
  const input = editor.getByRole('textbox', { name: /Add duration to Silence durations/ })

  await input.fill('2y')
  await input.press('Enter')
  await expect(editor.getByRole('alert')).toContainText('max 365d')

  await input.fill('1h')
  await input.press('Enter')
  await expect(editor.getByRole('alert')).toContainText('already in the list')

  await expect(editor.getByRole('listitem')).toHaveCount(8)
})

test('H15 instance defaults from the server replace the built-in silence durations', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await page.route('**/api/v1/settings', (route) =>
    route.fulfill({
      json: { user: null, global: { silenceDurations: [15, 60, 43200] } },
    }),
  )
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)
  await page.goto('/?state=active')

  expect(await fastSilenceOptions(page)).toEqual(['15m', '1h', '30d'])
  await page.keyboard.press('Escape')

  // A user's own list beats the instance default, and Reset returns to the instance default.
  const dialog = await openSettings(page)
  const editor = dialog.getByTestId('duration-list-editor').first()
  await editor.getByRole('button', { name: 'Remove 15m' }).click()
  await expect(editor.getByRole('button', { name: 'Reset' })).toBeVisible()
  await editor.getByRole('button', { name: 'Reset' }).click()
  await expect(editor.getByRole('button', { name: 'Remove 15m' })).toBeVisible()
  await expect(editor.getByRole('listitem')).toHaveCount(3)
})
