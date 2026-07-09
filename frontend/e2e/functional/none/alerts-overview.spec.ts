import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { kubernetesAlerts } from '../../fixtures/alerts'
import type { Page } from '@playwright/test'

async function ensureAlertsPage(page: Page) {
  await page.getByRole('button', { name: /^Alerts\b/ }).click()
  await expect(page.getByRole('button', { name: 'Add filter' })).toBeVisible()
}

async function resetPersistedUIState(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: {
        theme: 'dark',
        timeFormat: 'relative',
        defaultViewMode: 'card',
        defaultFilters: [],
        resolvedPageSize: 25,
        defaultSilenceDurationMinutes: 60,
        defaultCreatorName: '',
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
    localStorage.setItem('jarvis-viewMode', 'card')
    localStorage.setItem('jarvis-activeViewMode', 'card')
    localStorage.setItem('jarvis-silencesViewMode', 'card')
  })
  await page.goto('/')
}

async function visibleAlertCount(page: Page): Promise<number> {
  const [cardCount, listCount, groupedListCount] = await Promise.all([
    page.getByTestId('alert-card').count(),
    page.getByTestId('alert-list-row').count(),
    page.getByTestId('alert-group-row').count(),
  ])
  return Math.max(cardCount, listCount, groupedListCount)
}

test('opens the overview, shows the label breakdown, and clicking a value applies a filter', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.goto('/?state=active')
  await ensureAlertsPage(page)
  await expect.poll(() => visibleAlertCount(page)).toBe(kubernetesAlerts.length)

  await page.getByRole('button', { name: 'Open alerts overview' }).click()
  await expect(page.getByRole('heading', { name: 'Alerts Overview' })).toBeVisible()
  await expect(page.getByText(`Top label values across ${kubernetesAlerts.length} alerts`)).toBeVisible()

  // severity has 2 critical / 1 warning / 1 info across the fixture — click "critical".
  await page.getByRole('button', { name: 'Filter by severity=critical' }).click()

  // Modal closes and the matcher chip is applied.
  await expect(page.getByRole('heading', { name: 'Alerts Overview' })).toBeHidden()
  await expect.poll(() => decodeURIComponent(page.url())).toContain('"name":"severity"')
  await expect.poll(() => decodeURIComponent(page.url())).toContain('"value":"critical"')
  await expect.poll(() => visibleAlertCount(page)).toBe(2)
})

test('clicking an already-applied value does not add a duplicate matcher chip', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  const matchers = encodeURIComponent(JSON.stringify([{ name: 'severity', operator: '=', value: 'critical' }]))
  await page.goto(`/?state=active&matchers=${matchers}`)
  await ensureAlertsPage(page)
  await expect.poll(() => visibleAlertCount(page)).toBe(2)

  await page.getByRole('button', { name: 'Open alerts overview' }).click()
  await expect(page.getByRole('heading', { name: 'Alerts Overview' })).toBeVisible()
  await page.getByRole('button', { name: 'Filter by severity=critical' }).click()

  await expect(page.getByRole('heading', { name: 'Alerts Overview' })).toBeHidden()
  await expect.poll(() => visibleAlertCount(page)).toBe(2)
  const labelMatchers = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('jarvis-ui') ?? '{}').state.filters.labelMatchers,
  )
  expect(labelMatchers).toHaveLength(1)
})

test('shows the empty state when the current state tab has no alerts', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.goto('/?state=suppressed')
  await ensureAlertsPage(page)

  await page.getByRole('button', { name: 'Open alerts overview' }).click()
  await expect(page.getByRole('heading', { name: 'Alerts Overview' })).toBeVisible()
  await expect(page.getByText('No alerts to summarize.')).toBeVisible()
})
