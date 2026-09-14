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

function seedLabelDisplay(
  page: Page,
  labelDisplay: { order: string[]; hidden: string[] },
  extra: Record<string, unknown> = {},
) {
  return page.addInitScript(({ cfg, extra }) => {
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: {
        theme: 'dark', timeFormat: 'relative', defaultViewMode: 'card',
        defaultFilters: [], resolvedPageSize: 25, defaultSilenceDurationMinutes: 60,
        defaultCreatorName: '', claimAnimationEnabled: true, groupByLabel: 'severity',
        labelDisplay: cfg,
        ...extra,
      },
      version: 0,
    }))
  }, { cfg: labelDisplay, extra })
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

test('L4 pinning a label and dragging it above @cluster makes it the first chip', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')

  const strip = page.getByTestId('alert-card-common-labels')
  await expect(strip).toBeVisible({ timeout: 10_000 })

  const dialog = await openSettings(page)
  await dialog.getByRole('button', { name: 'Pin hostname' }).click()
  await expect(dialog.getByRole('button', { name: 'Unpin hostname' })).toBeVisible()

  // Reordering is mouse-driven drag (same technique as the card view's
  // section drag) — simulate it with raw mouse events.
  const grip = dialog.getByRole('button', { name: 'Drag hostname to reorder' })
  const clusterRow = dialog.getByRole('button', { name: 'Unpin @cluster' }).locator('..')
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

test('L5 pin and hide are mutually exclusive', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await seedLabelDisplay(page, { order: ['@cluster'], hidden: ['customer'] })
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')

  const dialog = await openSettings(page)
  await expect(dialog.getByRole('button', { name: 'Show customer' })).toBeVisible()

  await dialog.getByRole('button', { name: 'Pin customer' }).click()
  await expect(dialog.getByRole('button', { name: 'Unpin customer' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Hide customer' })).toBeVisible()

  await dialog.getByRole('button', { name: 'Hide customer' }).click()
  await expect(dialog.getByRole('button', { name: 'Show customer' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Pin customer' })).toBeVisible()

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis-user-settings') ?? '{}').state)
  expect(stored.labelDisplay).toEqual({ order: ['@cluster'], hidden: ['customer'] })
})

test('L6 real-time search filters the label list', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')

  const dialog = await openSettings(page)
  const list = dialog.getByTestId('label-list')
  await expect(list.getByText('customer', { exact: true })).toBeVisible()
  await expect(list.getByText('hostname', { exact: true })).toBeVisible()

  await dialog.getByPlaceholder('Filter labels…').fill('host')
  await expect(list.getByText('hostname', { exact: true })).toBeVisible()
  await expect(list.getByText('customer', { exact: true })).toHaveCount(0)
  await expect(list.getByText('@cluster', { exact: true })).toHaveCount(0)

  await dialog.getByRole('button', { name: 'Clear filter' }).click()
  await expect(list.getByText('customer', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Drag @cluster to reorder' })).toBeVisible()
})

test('L7 hiding a label keeps its alphabetical position', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')

  const dialog = await openSettings(page)
  // "cluster" (raw label) < "customer" < "hostname" alphabetically — the
  // unpinned labels this alert produces, with no config applied yet.
  const unpinned = dialog.getByTestId('unpinned-labels')

  const before = await unpinned.innerText()
  expect(before.indexOf('cluster')).toBeLessThan(before.indexOf('customer'))
  expect(before.indexOf('customer')).toBeLessThan(before.indexOf('hostname'))

  await dialog.getByRole('button', { name: 'Hide customer' }).click()

  const after = await unpinned.innerText()
  expect(after.indexOf('cluster')).toBeLessThan(after.indexOf('customer'))
  expect(after.indexOf('customer')).toBeLessThan(after.indexOf('hostname'))
})

test('L8 a "+N" chip opens the hidden label for that alert in a floating layer', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await seedLabelDisplay(page, { order: ['@cluster'], hidden: ['customer'] })
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')

  const strip = page.getByTestId('alert-card-common-labels')
  const toggle = strip.getByRole('button', { name: '1 hidden label' })
  await expect(toggle).toBeVisible({ timeout: 10_000 })
  await expect(toggle).toHaveText('+1')
  await expect(page.getByText('acme-corp')).toHaveCount(0)

  const cardBoxBefore = (await page.getByTestId('alert-card').first().boundingBox())!
  await toggle.click()

  // Revealed in a floating layer, not inline in the strip — the card's own
  // box must not change height (the CSS-column card grid would otherwise
  // reflow and visibly move the alert into a different column).
  const popover = page.getByTestId('hidden-labels-popover')
  await expect(popover).toBeVisible()
  await expect(popover.getByText('acme-corp')).toBeVisible()
  await expect(strip.getByText('acme-corp')).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const cardBoxAfter = (await page.getByTestId('alert-card').first().boundingBox())!
  expect(cardBoxAfter.height).toBe(cardBoxBefore.height)

  await toggle.click()
  await expect(popover).toHaveCount(0)

  // Reopen, then dismiss by clicking outside — same as any other popover.
  await toggle.click()
  await expect(popover).toBeVisible()
  await page.mouse.click(10, 10)
  await expect(popover).toHaveCount(0)
})

test('L9 reset to defaults restores every chip and the original order', async ({ page, am, jarvis }) => {
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

test('L10 a palette color applies to the chip and can be removed again', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')

  const chip = page.getByTestId('alert-card-common-labels').getByText('acme-corp')
  await expect(chip).toBeVisible({ timeout: 10_000 })
  await expect(chip).not.toHaveAttribute('style', /background-color/)

  const dialog = await openSettings(page)
  const swatch = dialog.getByRole('button', { name: 'Choose a chip color for customer' })
  await swatch.click()
  const picker = page.getByTestId('label-color-picker')
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: 'Color customer blue' }).click()
  await expect(picker).toHaveCount(0)
  await expect(swatch).toHaveAttribute('title', 'Chip color: blue')
  await page.getByRole('button', { name: 'Close' }).click()

  await expect(chip).toHaveAttribute('style', /background-color/)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis-user-settings') ?? '{}').state)
  expect(stored.labelColors).toEqual({ customer: 'blue' })

  const reopened = await openSettings(page)
  await reopened.getByRole('button', { name: 'Choose a chip color for customer' }).click()
  await page.getByRole('button', { name: 'Remove color for customer' }).click()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(chip).not.toHaveAttribute('style', /background-color/)
})

test('L11 "Reset labels" only resets the Labels section, not other settings', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await seedLabelDisplay(
    page,
    { order: ['@cluster'], hidden: ['customer'] },
    { defaultViewMode: 'list', labelColors: { hostname: 'amber' } },
  )
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')

  const dialog = await openSettings(page)
  await dialog.getByRole('button', { name: 'Reset labels' }).click()
  await expect(dialog.getByRole('button', { name: 'Click again to confirm — resets labels' })).toBeVisible()

  const beforeConfirmation = await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis-user-settings') ?? '{}').state)
  expect(beforeConfirmation.labelDisplay.hidden).toEqual(['customer'])
  expect(beforeConfirmation.labelColors).toEqual({ hostname: 'amber' })

  await dialog.getByRole('button', { name: 'Click again to confirm — resets labels' }).click()
  await page.getByRole('button', { name: 'Close' }).click()

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis-user-settings') ?? '{}').state)
  expect(stored.labelDisplay).toEqual({ order: ['@cluster'], hidden: [] })
  expect(stored.labelColors).toEqual({})
  // The unrelated defaultViewMode change survives untouched.
  expect(stored.defaultViewMode).toBe('list')
})

test('L12 a configured label stays editable while no alert carries it', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await seedLabelDisplay(page, { order: ['@cluster'], hidden: ['customer'] })
  await page.goto('/?state=active')

  const dialog = await openSettings(page)
  await expect(dialog.getByText('No labels seen yet.')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Show customer' })).toBeVisible()
  // Still configured after the toggle (pinned now), so the row stays listed.
  await dialog.getByRole('button', { name: 'Pin customer' }).click()
  await expect(dialog.getByRole('button', { name: 'Unpin customer' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Hide customer' })).toBeVisible()
})

test('L13 "Hide all" / "Show all" toggles every unpinned label, never a pinned one', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')

  const dialog = await openSettings(page)
  await dialog.getByRole('button', { name: 'Hide all' }).click()
  await expect(dialog.getByRole('button', { name: 'Show all' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Show cluster' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Show customer' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Show hostname' })).toBeVisible()
  // @cluster is pinned by default — bulk hide leaves it alone.
  await expect(dialog.getByRole('button', { name: 'Hide @cluster' })).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()

  const strip = page.getByTestId('alert-card-common-labels')
  // Every unpinned label collapses into one "+N" chip; only pinned @cluster stays.
  const toggle = strip.getByRole('button', { name: /^\d+ hidden labels$/ })
  await expect(toggle).toBeVisible()
  await expect(strip.getByText('acme-corp')).toHaveCount(0)
  await expect(strip.getByText('web-042')).toHaveCount(0)
  await expect(strip.getByText('@cluster')).toBeVisible()

  await toggle.click()
  const popover = page.getByTestId('hidden-labels-popover')
  await expect(popover.getByText('acme-corp')).toBeVisible()
  await expect(popover.getByText('web-042')).toBeVisible()
  await page.mouse.click(10, 10)
  await expect(popover).toHaveCount(0)

  const reopened = await openSettings(page)
  await reopened.getByRole('button', { name: 'Show all' }).click()
  await expect(reopened.getByRole('button', { name: 'Hide all' })).toBeVisible()
  await expect(reopened.getByRole('button', { name: 'Hide customer' })).toBeVisible()
})

test('L14 "Hide all" only affects unpinned labels matching the current search', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(singleAlert)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, singleAlert.length)
  await page.goto('/?state=active')

  const dialog = await openSettings(page)
  await dialog.getByPlaceholder('Filter labels…').fill('host')
  await dialog.getByRole('button', { name: 'Hide all' }).click()
  await expect(dialog.getByRole('button', { name: 'Show hostname' })).toBeVisible()

  await dialog.getByRole('button', { name: 'Clear filter' }).click()
  await expect(dialog.getByRole('button', { name: 'Show hostname' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Hide customer' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Hide cluster' })).toBeVisible()
})
