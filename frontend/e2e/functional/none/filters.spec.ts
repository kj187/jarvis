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

const c11Alerts = [
  {
    labels: {
      alertname: 'C11SearchTargetAlert',
      severity: 'critical',
      cluster: 'e2e',
      team: 'c11-platform',
    },
    annotations: {
      summary: 'C11 search target alert',
    },
  },
  {
    labels: {
      alertname: 'C11ControlAlert',
      severity: 'warning',
      cluster: 'e2e',
      team: 'c11-observability',
    },
    annotations: {
      summary: 'C11 control alert',
    },
  },
]

test('C1 exact matcher is added and reflected in URL', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.goto('/?state=active')
  await ensureAlertsPage(page)
  await page.getByRole('button', { name: 'Add filter' }).click()

  const label = page.getByLabel('Label name')
  const value = page.getByLabel('Label value')

  await label.fill('severity')
  await label.press('Enter')
  await value.fill('critical')
  await value.press('Enter')

  await expect.poll(() => decodeURIComponent(page.url())).toContain('"name":"severity"')
  await expect.poll(() => decodeURIComponent(page.url())).toContain('"operator":"="')
  await expect.poll(() => decodeURIComponent(page.url())).toContain('"value":"critical"')
})

test('C10 matcher state is restored from URL', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  const matchers = encodeURIComponent(JSON.stringify([{ name: 'severity', operator: '=', value: 'critical' }]))
  await page.goto(`/?state=active&matchers=${matchers}`)
  await ensureAlertsPage(page)

  await expect(page.getByText('severity', { exact: true })).toBeVisible()
  await expect(page.getByText('critical', { exact: true })).toBeVisible()
})

test('C11 search via ?q= filters by alertname/labels', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await am.fire(c11Alerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, c11Alerts.length)

  await page.goto('/?state=active')
  await ensureAlertsPage(page)
  await expect.poll(() => visibleAlertCount(page)).toBeGreaterThan(0)
  const totalVisible = await visibleAlertCount(page)

  await page.goto('/?state=active&q=c11searchtarget')
  await ensureAlertsPage(page)
  await expect.poll(() => visibleAlertCount(page)).toBeLessThan(totalVisible)
  await expect.poll(() => visibleAlertCount(page)).toBeGreaterThan(0)
})

test('C11 search via the toggle input filters by label value', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await am.fire(c11Alerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, c11Alerts.length)

  await page.goto('/?state=active')
  await ensureAlertsPage(page)
  await expect.poll(() => visibleAlertCount(page)).toBeGreaterThan(0)
  const totalVisible = await visibleAlertCount(page)
  await page.getByLabel('Toggle search').click()
  await page.getByLabel('Search alerts').fill('c11-platform')
  await expect.poll(() => visibleAlertCount(page)).toBeLessThan(totalVisible)
  await expect.poll(() => visibleAlertCount(page)).toBeGreaterThan(0)
})

test('D1 @age filter matches by alert age', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  const now = new Date()
  const old = new Date(now.getTime() - 20 * 60_000).toISOString()
  await am.fire([
    { labels: { alertname: 'D1FreshAlert', severity: 'warning' }, startsAt: now.toISOString() },
    { labels: { alertname: 'D1OldAlert', severity: 'warning' }, startsAt: old },
  ])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 2)

  await page.goto('/?state=active')
  await ensureAlertsPage(page)
  await expect.poll(() => visibleAlertCount(page)).toBe(2)

  await page.getByRole('button', { name: 'Add filter' }).click()
  const label = page.getByLabel('Label name')
  await label.fill('@age')
  await label.press('Enter')
  const value = page.getByLabel('Label value')
  await value.fill('15m')
  await value.press('Enter')

  // Operator auto-snaps to `>` when the field becomes @age (decision 1/7).
  await expect.poll(() => decodeURIComponent(page.url())).toContain('"name":"@age"')
  await expect.poll(() => decodeURIComponent(page.url())).toContain('"operator":">"')
  await expect.poll(() => visibleAlertCount(page)).toBe(1)
  await expect(page.getByText('D1OldAlert').first()).toBeVisible()
  await expect(page.getByText('D1FreshAlert')).toHaveCount(0)
})

test('D2 @claimed-by filter matches the active claim', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
  const alerts: any[] = await res.json()
  await jarvis.setClaim(alerts[0].fingerprint, 'd2-claimer')

  await page.goto('/?state=active')
  await ensureAlertsPage(page)
  await expect.poll(() => visibleAlertCount(page)).toBe(kubernetesAlerts.length)

  await page.getByRole('button', { name: 'Add filter' }).click()
  const label = page.getByLabel('Label name')
  await label.fill('@claimed-by')
  await label.press('Enter')
  const value = page.getByLabel('Label value')
  await value.fill('d2-claimer')
  await value.press('Enter')

  await expect.poll(() => decodeURIComponent(page.url())).toContain('"name":"@claimed-by"')
  await expect.poll(() => visibleAlertCount(page)).toBe(1)
})

test('D3 invalid @age duration cannot be committed as a chip', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.goto('/?state=active')
  await ensureAlertsPage(page)
  await page.getByRole('button', { name: 'Add filter' }).click()

  const label = page.getByLabel('Label name')
  await label.fill('@age')
  await label.press('Enter')
  const value = page.getByLabel('Label value')
  await value.fill('bogus')
  await value.press('Enter')

  // Draft stays open (not promoted to a real filter) — no matchers param in the URL.
  await page.waitForTimeout(300)
  expect(page.url()).not.toContain('matchers=')
  await expect.poll(() => visibleAlertCount(page)).toBe(kubernetesAlerts.length)
})

test('C12 search from ?q= is prefilled and ESC clears/closes search', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await am.fire(c11Alerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, c11Alerts.length)

  await page.goto('/?state=active&q=c11searchtarget')
  await ensureAlertsPage(page)

  await page.getByLabel('Toggle search').click()
  const searchInput = page.getByLabel('Search alerts')
  await expect(searchInput).toBeVisible()
  await expect(searchInput).toHaveValue('c11searchtarget')

  await searchInput.press('Escape')
  await expect(searchInput).toBeHidden()
  await expect(page.getByLabel('Toggle search')).toBeVisible()
})
