import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import type { Page } from '@playwright/test'
import type { AlertInput } from '../../support/alertmanager'

/**
 * Catalog: configurable label display (Settings → Labels, issue #189).
 * A single alert is enough for these — with no siblings, all of its labels
 * are "common" and render in the card's shared-label strip
 * (`data-testid="alert-card-common-labels"`).
 */
const singleAlert: AlertInput[] = [
  {
    labels: {
      alertname: 'LabelDisplayTestAlert',
      severity: 'warning',
      cluster: 'e2e',
      customer: 'acme-corp',
      hostname: 'web-042',
    },
    annotations: { summary: 'Exercises the configurable label chip display' },
  },
]

async function openSettings(page: Page) {
  await page.getByTestId('user-menu').click()
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  return dialog
}

function seedLabelDisplay(page: Page, labelDisplay: { order: string[]; hidden: string[] }) {
  return page.addInitScript((cfg) => {
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: {
        theme: 'dark', timeFormat: 'relative', defaultViewMode: 'card',
        defaultFilters: [], resolvedPageSize: 25, defaultSilenceDurationMinutes: 60,
        defaultCreatorName: '', claimAnimationEnabled: true, groupByLabel: 'severity',
        labelDisplay: cfg,
      },
      version: 0,
    }))
  }, labelDisplay)
}

test('L1 hiding a label via the eye toggle removes its chip from the card view', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')

  const strip = page.getByTestId('alert-card-common-labels')
  await expect(strip.getByText('acme-corp')).toBeVisible({ timeout: 10_000 })

  const dialog = await openSettings(page)
  await dialog.getByRole('button', { name: 'Hide customer' }).click()
  await page.getByRole('button', { name: 'Close' }).click()

  await expect(page.getByText('acme-corp')).toHaveCount(0)
})

test('L2 a hidden label stays hidden in the list view too', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await seedLabelDisplay(page, { order: ['@cluster'], hidden: ['customer'] })
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')
  await page.getByTitle('List View').click()

  await expect(page.getByTestId('alert-group-row').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('acme-corp')).toHaveCount(0)
})

test('L3 hidden labels remain visible in the alert detail panel', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await seedLabelDisplay(page, { order: ['@cluster'], hidden: ['customer'] })
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')

  await page.getByTestId('alert-card').first().click()
  await expect(page.getByTestId('detail-panel')).toBeVisible()

  const labelsSection = page.getByTestId('detail-labels-section')
  await expect(labelsSection.getByText('acme-corp')).toBeVisible()
})

test('L4 adding a label to priority and dragging it above @cluster makes it the first chip', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')

  const strip = page.getByTestId('alert-card-common-labels')
  await expect(strip).toBeVisible({ timeout: 10_000 })

  const dialog = await openSettings(page)
  await dialog.getByRole('button', { name: 'Add hostname to priority order' }).click()

  // Reordering is mouse-driven drag (same technique as the card view's
  // section drag, Grip icon included) — no click target for "move up"
  // exists any more, so simulate the drag with raw mouse events.
  const grip = dialog.getByRole('button', { name: 'Drag hostname to reorder' })
  const clusterRow = dialog.getByRole('button', { name: 'Remove @cluster from priority order' }).locator('..')
  const gripBox = (await grip.boundingBox())!
  const clusterBox = (await clusterRow.boundingBox())!

  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(clusterBox.x + clusterBox.width / 2, clusterBox.y + 2, { steps: 5 })
  await page.mouse.up()

  await page.getByRole('button', { name: 'Close' }).click()

  const text = await strip.innerText()
  expect(text.indexOf('hostname')).toBeGreaterThanOrEqual(0)
  expect(text.indexOf('hostname')).toBeLessThan(text.indexOf('@cluster'))
  expect(text.indexOf('@cluster')).toBeLessThan(text.indexOf('customer'))
})

test('L6 real-time search filters the Other labels list', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')

  const dialog = await openSettings(page)
  await expect(dialog.getByText('customer', { exact: true })).toBeVisible()
  await expect(dialog.getByText('hostname', { exact: true })).toBeVisible()

  await dialog.getByPlaceholder('Filter labels…').fill('host')
  await expect(dialog.getByText('hostname', { exact: true })).toBeVisible()
  await expect(dialog.getByText('customer', { exact: true })).toHaveCount(0)

  await dialog.getByRole('button', { name: 'Clear filter' }).click()
  await expect(dialog.getByText('customer', { exact: true })).toBeVisible()
})

test('L7 hiding a label keeps its alphabetical position instead of moving to the bottom', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')

  const dialog = await openSettings(page)
  // "cluster" (raw label) < "customer" < "hostname" alphabetically — the
  // Other labels list this alert produces, with no config applied yet.
  const otherLabelsList = dialog.getByTestId('other-labels-list')

  const before = await otherLabelsList.innerText()
  expect(before.indexOf('cluster')).toBeLessThan(before.indexOf('customer'))
  expect(before.indexOf('customer')).toBeLessThan(before.indexOf('hostname'))

  await dialog.getByRole('button', { name: 'Hide customer' }).click()

  const after = await otherLabelsList.innerText()
  expect(after.indexOf('cluster')).toBeLessThan(after.indexOf('customer'))
  expect(after.indexOf('customer')).toBeLessThan(after.indexOf('hostname'))
})

test('L5 reset to defaults restores every chip and the original order', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await seedLabelDisplay(page, { order: ['hostname', '@cluster'], hidden: ['customer'] })
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')

  await expect(page.getByText('acme-corp')).toHaveCount(0)

  const dialog = await openSettings(page)
  await dialog.getByRole('button', { name: 'Reset all settings' }).click()
  await dialog.getByRole('button', { name: /Click again to confirm/ }).click()
  await page.getByRole('button', { name: 'Close' }).click()

  const strip = page.getByTestId('alert-card-common-labels')
  await expect(strip.getByText('acme-corp')).toBeVisible({ timeout: 5_000 })

  const text = await strip.innerText()
  expect(text.indexOf('@cluster')).toBeGreaterThanOrEqual(0)
  expect(text.indexOf('@cluster')).toBeLessThan(text.indexOf('customer'))
  expect(text.indexOf('customer')).toBeLessThan(text.indexOf('hostname'))
})

test('L8 a "labels hidden" chip reveals the hidden label for that alert on click', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await seedLabelDisplay(page, { order: ['@cluster'], hidden: ['customer'] })
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')

  const strip = page.getByTestId('alert-card-common-labels')
  const toggle = strip.getByRole('button', { name: '1 label hidden' })
  await expect(toggle).toBeVisible({ timeout: 10_000 })
  await expect(strip.getByText('acme-corp')).toHaveCount(0)

  await toggle.click()
  await expect(strip.getByText('acme-corp')).toBeVisible()

  await toggle.click()
  await expect(strip.getByText('acme-corp')).toHaveCount(0)
})

test('L10 "Hide all" / "Show all" toggles every label the current filter shows', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')

  const dialog = await openSettings(page)
  await expect(dialog.getByRole('button', { name: 'Hide all' })).toBeVisible()

  await dialog.getByRole('button', { name: 'Hide all' }).click()
  await expect(dialog.getByRole('button', { name: 'Show all' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Show cluster' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Show customer' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Show hostname' })).toBeVisible()

  await dialog.getByRole('button', { name: 'Show all' }).click()
  await expect(dialog.getByRole('button', { name: 'Hide all' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Hide cluster' })).toBeVisible()
})

test('L11 "Hide all" only affects labels matching the current search filter', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')

  const dialog = await openSettings(page)
  await dialog.getByPlaceholder('Filter labels…').fill('host')
  await dialog.getByRole('button', { name: 'Hide all' }).click()
  await expect(dialog.getByRole('button', { name: 'Show hostname' })).toBeVisible()

  await dialog.getByPlaceholder('Filter labels…').fill('')
  await expect(dialog.getByRole('button', { name: 'Show hostname' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Hide customer' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Hide cluster' })).toBeVisible()
})

test('L9 "Reset labels" only resets the Labels section, not other settings', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await page.addInitScript(() => {
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: {
        theme: 'dark', timeFormat: 'relative', defaultViewMode: 'list',
        defaultFilters: [], resolvedPageSize: 25, defaultSilenceDurationMinutes: 60,
        defaultCreatorName: '', claimAnimationEnabled: true, groupByLabel: 'severity',
        labelDisplay: { order: ['@cluster'], hidden: ['customer'] },
      },
      version: 0,
    }))
  })
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')

  const dialog = await openSettings(page)
  await dialog.getByRole('button', { name: 'Reset labels' }).click()
  await page.getByRole('button', { name: 'Close' }).click()

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('jarvis-user-settings')
    return raw ? JSON.parse(raw).state : null
  })
  expect(stored.labelDisplay).toEqual({ order: ['@cluster'], hidden: [] })
  // The unrelated defaultViewMode change survives untouched.
  expect(stored.defaultViewMode).toBe('list')
})
