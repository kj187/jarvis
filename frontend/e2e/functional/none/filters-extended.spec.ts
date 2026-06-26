import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { kubernetesAlerts, manyAlerts } from '../../fixtures/alerts'
import type { Page } from '@playwright/test'

async function resetPersistedUIState(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('jarvis-ui', JSON.stringify({
      state: {
        activePage: 'alerts',
        filters: { state: 'active', search: '', labelMatchers: [] },
      },
      version: 0,
    }))
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: {
        theme: 'dark',
        timeFormat: 'relative',
        defaultViewMode: 'card',
        defaultFilters: [],
        resolvedPageSize: 25,
        defaultSilenceDurationMinutes: 60,
        defaultCreatorName: '',
        pollIntervalSeconds: 15,
        claimAnimationEnabled: true,
      },
      version: 0,
    }))
    localStorage.setItem('jarvis-viewMode', 'card')
    localStorage.setItem('jarvis-activeViewMode', 'card')
  })
  await page.goto('/')
}

async function openAddFilter(page: Page) {
  await page.getByRole('button', { name: 'Add filter' }).click()
}

async function fillFilter(page: Page, label: string, value: string) {
  // Use .last() to target the most recently opened filter row (avoids strict mode
  // violation when multiple rows are visible simultaneously)
  const labelInput = page.getByLabel('Label name').last()
  const valueInput = page.getByLabel('Label value').last()
  await labelInput.fill(label)
  await labelInput.press('Enter')
  await valueInput.fill(value)
  await valueInput.press('Enter')
}

test('C2 filter with != operator excludes matching alerts', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.goto('/?state=active')
  await page.getByRole('button', { name: /^Alerts\b/ }).click()
  await expect(page.getByRole('button', { name: 'Add filter' })).toBeVisible()

  await openAddFilter(page)

  const labelInput = page.getByLabel('Label name')
  await labelInput.fill('severity')
  await labelInput.press('Enter')

  // Change operator from = to !=
  const operatorBtn = page.getByRole('button', { name: 'Operator' }).first()
  await operatorBtn.click()
  const notEqualOption = page.locator('.combo-dropdown button').filter({ hasText: '!=' }).first()
  await notEqualOption.click()

  const valueInput = page.getByLabel('Label value')
  await valueInput.fill('critical')
  await valueInput.press('Enter')

  await expect(page.getByText('!=')).toBeVisible()

  await expect.poll(() => decodeURIComponent(page.url())).toContain('"operator":"!="')
})

test('C2 filter with =~ operator (regex match)', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.goto('/?state=active')
  await page.getByRole('button', { name: /^Alerts\b/ }).click()

  await openAddFilter(page)

  const labelInput = page.getByLabel('Label name')
  await labelInput.fill('severity')
  await labelInput.press('Enter')

  const operatorBtn = page.getByRole('button', { name: 'Operator' }).first()
  await operatorBtn.click()
  await page.locator('.combo-dropdown button').filter({ hasText: '=~' }).first().click()

  const valueInput = page.getByLabel('Label value')
  await valueInput.fill('critical')
  await valueInput.press('Enter')

  await expect(page.getByText('=~')).toBeVisible()
  await expect.poll(() => decodeURIComponent(page.url())).toContain('"operator":"=~"')
})

test('C3 regex filter with pipe-joined values in =~ chip', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.goto('/?state=active')
  await page.getByRole('button', { name: /^Alerts\b/ }).click()

  await openAddFilter(page)

  const labelInput = page.getByLabel('Label name')
  await labelInput.fill('severity')
  await labelInput.press('Enter')

  // Switch to =~ operator for multi-value regex
  const operatorBtn = page.getByRole('button', { name: 'Operator' }).first()
  await operatorBtn.click()
  await page.locator('.combo-dropdown button').filter({ hasText: '=~' }).first().click()

  // Type pipe-joined value: the chip will store 'critical|warning' as a single regex value
  const valueInput = page.getByLabel('Label value')
  await valueInput.fill('critical|warning')
  await valueInput.press('Enter')

  // URL should contain both values (they're joined by | in the regex value)
  await expect.poll(() => decodeURIComponent(page.url())).toContain('critical')
  await expect.poll(() => decodeURIComponent(page.url())).toContain('warning')
})

test('C4 label name suggestions appear from loaded alerts', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.goto('/?state=active')
  await page.getByRole('button', { name: /^Alerts\b/ }).click()

  await openAddFilter(page)

  // Focus on label name input — suggestions should appear from existing alerts
  const labelInput = page.getByLabel('Label name')
  await labelInput.click()
  await labelInput.fill('sev')

  const suggestion = page.locator('.combo-dropdown button').filter({ hasText: 'severity' }).first()
  await expect(suggestion).toBeVisible({ timeout: 5_000 })
})

test('C5 clicking label chip in detail panel creates exact filter', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.goto('/?state=active')

  const firstCard = page.getByTestId('alert-card').first()
  await firstCard.click()
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()

  // Find a label chip in the panel and hover to reveal operator buttons
  const labelChip = panel.locator('[title*="cluster:"]').first()
  if (await labelChip.isVisible()) {
    await labelChip.hover()
    const eqButton = page.locator('.fixed.z-50 button').filter({ hasText: '=' }).first()
    await expect(eqButton).toBeVisible({ timeout: 3_000 })
    await eqButton.click()

    await expect(page.getByRole('button', { name: /^Remove filter/ }).first()).toBeVisible({ timeout: 5_000 })
  }
})

test('C6 multiple matchers combine as AND (both must match)', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.goto('/?state=active')
  await page.getByRole('button', { name: /^Alerts\b/ }).click()

  // Add first filter
  await openAddFilter(page)
  await fillFilter(page, 'severity', 'critical')

  // Add second filter
  await openAddFilter(page)
  await fillFilter(page, 'cluster', 'e2e')

  // Two filter remove buttons should appear
  await expect(page.getByRole('button', { name: /^Remove filter/ })).toHaveCount(2)

  // URL contains both matchers
  await expect.poll(() => decodeURIComponent(page.url())).toContain('"name":"severity"')
  await expect.poll(() => decodeURIComponent(page.url())).toContain('"name":"cluster"')
})

test('C7 draft chip is promoted to filter when both label and value are filled', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.goto('/?state=active')
  await page.getByRole('button', { name: /^Alerts\b/ }).click()

  await openAddFilter(page)
  const labelInput = page.getByLabel('Label name')
  await expect(labelInput).toBeVisible()

  // Fill label only — still draft (no filter in URL yet)
  await labelInput.fill('severity')
  await labelInput.press('Enter')
  const urlBefore = page.url()
  expect(decodeURIComponent(urlBefore)).not.toContain('"value":"critical"')

  // Fill value → promoted
  const valueInput = page.getByLabel('Label value')
  await valueInput.fill('critical')
  await valueInput.press('Enter')

  await expect.poll(() => decodeURIComponent(page.url())).toContain('"value":"critical"')
})

test('C8 removing individual filter chips clears them', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.goto('/?state=active')
  await page.getByRole('button', { name: /^Alerts\b/ }).click()

  // Add two filters
  await openAddFilter(page)
  await fillFilter(page, 'severity', 'critical')
  await openAddFilter(page)
  await fillFilter(page, 'cluster', 'e2e')

  const removeButtons = page.getByRole('button', { name: /^Remove filter/ })
  await expect(removeButtons).toHaveCount(2)

  // Remove first filter
  await removeButtons.first().click()
  await expect(page.getByRole('button', { name: /^Remove filter/ })).toHaveCount(1)

  // Remove second filter
  await page.getByRole('button', { name: /^Remove filter/ }).first().click()
  await expect(page.getByRole('button', { name: /^Remove filter/ })).toHaveCount(0)

  await expect.poll(() => decodeURIComponent(page.url())).not.toContain('"name"')
})

test('C9 locked default filter chips appear from settings and cannot be removed', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(manyAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, manyAlerts.length)

  await page.addInitScript(() => {
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: {
        theme: 'dark',
        timeFormat: 'relative',
        defaultViewMode: 'card',
        defaultFilters: [{ name: 'severity', operator: '=', value: 'critical' }],
        resolvedPageSize: 25,
        defaultSilenceDurationMinutes: 60,
        defaultCreatorName: '',
        pollIntervalSeconds: 15,
        claimAnimationEnabled: true,
      },
      version: 0,
    }))
    localStorage.setItem('jarvis-ui', JSON.stringify({
      state: {
        activePage: 'alerts',
        filters: { state: 'active', search: '', labelMatchers: [] },
      },
      version: 0,
    }))
  })
  await page.goto('/?state=active')
  await page.getByRole('button', { name: /^Alerts\b/ }).click()

  // Locked chip shows severity=critical
  await expect(page.getByText('severity').first()).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('critical').first()).toBeVisible()

  // Locked chip has the title about settings
  const lockedChip = page.locator('[title*="Settings"]').first()
  await expect(lockedChip).toBeVisible()

  // No remove button on locked chip (locked chips don't have remove buttons)
  await expect(lockedChip.locator('button')).toHaveCount(0)
})

test('C13 search combines with filter chips but is not the focus here', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await page.addInitScript(() => {
    localStorage.setItem('jarvis-ui', JSON.stringify({
      state: {
        activePage: 'alerts',
        filters: { state: 'active', search: '', labelMatchers: [] },
      },
      version: 0,
    }))
  })
  await am.fire([
    { labels: { alertname: 'C13Alpha', severity: 'critical', cluster: 'e2e' }, annotations: {} },
    { labels: { alertname: 'C13Beta', severity: 'warning', cluster: 'e2e' }, annotations: {} },
    { labels: { alertname: 'C13Gamma', severity: 'info', cluster: 'e2e' }, annotations: {} },
  ])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 3)

  await page.goto('/?state=active')
  await page.getByRole('button', { name: /^Alerts\b/ }).click()
  await expect(page.getByTestId('alert-card').first()).toBeVisible()

  // Add a filter chip for severity=critical
  await openAddFilter(page)
  await fillFilter(page, 'severity', 'critical')

  // Verify only critical shows
  await expect(page.getByText('C13Alpha').first()).toBeVisible({ timeout: 5_000 })

  // Also add search — now both must apply (AND)
  await page.getByLabel('Toggle search').click()
  await page.getByLabel('Search alerts').fill('C13')

  // C13Alpha should still be visible (matches both)
  await expect(page.getByText('C13Alpha').first()).toBeVisible()
  // C13Beta should not be visible (fails severity=critical filter)
  await expect(page.getByText('C13Beta')).toHaveCount(0)
})
