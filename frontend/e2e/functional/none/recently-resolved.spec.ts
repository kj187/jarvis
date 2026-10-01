import { test, expect, waitForActiveAlerts, waitForResolvedBuffer, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import type { AlertInput, AlertmanagerClient } from '../../support/alertmanager'
import type { JarvisClient } from '../../support/jarvis'
import type { Page } from '@playwright/test'

/**
 * "Recently resolved" toggle (Active tab): alerts that resolved within the
 * instance's resolved-buffer TTL are already in the live snapshot; the toggle
 * lists them in the same list, dimmed and badged "Resolved". Off by default.
 * Each test starts from a wiped store (the fixtures reset Jarvis, which also
 * clears the resolved buffer).
 */

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

const activeNew: AlertInput = {
  labels: { alertname: 'RrActiveNew', severity: 'critical', team: 'rr' },
  annotations: { summary: 'rr-active-new' },
  startsAt: minutesAgo(10),
}
const activeOld: AlertInput = {
  labels: { alertname: 'RrActiveOld', severity: 'critical', team: 'rr' },
  annotations: { summary: 'rr-active-old' },
  startsAt: minutesAgo(30),
}
const resolvedMid: AlertInput = {
  labels: { alertname: 'RrResolvedMid', severity: 'critical', team: 'rr' },
  annotations: { summary: 'rr-resolved-mid' },
  startsAt: minutesAgo(20),
}

async function openAlerts(page: Page, view: 'card' | 'list', grouping = true) {
  await page.addInitScript(([v, g]) => {
    // Start every test from an explicit "toggle off" (independent of the built-in default), once per tab so a reload keeps the choice.
    if (!sessionStorage.getItem('rr-init')) {
      sessionStorage.setItem('rr-init', '1')
      localStorage.setItem('jarvis-user-settings', JSON.stringify({ state: { showRecentlyResolved: false, overrides: { showRecentlyResolved: false }, anonOverrides: { showRecentlyResolved: false } }, version: 3 }))
    }
    localStorage.setItem('jarvis-viewMode', v)
    localStorage.setItem('jarvis-activeViewMode', v)
    localStorage.setItem('jarvis-alert-card-grouping-enabled', g)
  }, [view, String(grouping)])
  await page.goto('/?state=active')
  await expect(page.getByRole('button', { name: 'Add filter' })).toBeVisible()
}

/** Fires everything, then resolves `resolved` so it lands in the resolved buffer. */
async function seed(am: AlertmanagerClient, jarvis: JarvisClient, active: AlertInput[], resolved: AlertInput[]) {
  await am.fire([...active, ...resolved])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, active.length + resolved.length)
  await am.resolve(resolved)
  await waitForResolvedBuffer(jarvis, JARVIS_BASE_URL, resolved.length)
}

const toggle = (page: Page) => page.getByRole('button', { name: 'Show recently resolved alerts' })
const entry = (page: Page, summary: string) => page.getByTestId('alert-card').filter({ hasText: summary })
const headerCount = (page: Page) => page.getByRole('button', { name: /^Alerts\b/ }).locator('.tabular-nums')

test.describe('Recently resolved toggle', () => {
  test('is off by default: buffer entries stay hidden and the toggle is offered only in the Active tab', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await seed(am, jarvis, [activeNew], [resolvedMid])
    await openAlerts(page, 'card')

    await expect(toggle(page)).toBeVisible()
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')
    await expect(entry(page, 'rr-active-new')).toBeVisible()
    await expect(entry(page, 'rr-resolved-mid')).toHaveCount(0)

    await page.getByRole('button', { name: 'Suppressed' }).click()
    await expect(toggle(page)).toHaveCount(0)
    await page.getByRole('button', { name: 'Resolved' }).click()
    await expect(toggle(page)).toHaveCount(0)
  })

  test('shows the resolved entry badged without raising any active counter, and remembers the choice after a reload', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await seed(am, jarvis, [activeNew, activeOld], [resolvedMid])
    await openAlerts(page, 'card')
    await expect(headerCount(page)).toHaveText('2')

    await toggle(page).click()
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
    const resolved = entry(page, 'rr-resolved-mid')
    await expect(resolved).toBeVisible()
    // The "Resolved" marker is the first chip of the card's label strip (single-entry card), not a badge.
    const card = page.getByTestId('alert-group-card').filter({ hasText: 'RrResolvedMid' })
    await expect(card.getByTestId('resolved-chip')).toHaveCount(1)
    await expect(card.getByTestId('alert-card-common-labels').locator(':scope > *').first()).toHaveAttribute('data-testid', 'resolved-chip')
    await expect(page.getByTestId('alert-group-card').filter({ hasText: 'RrActiveNew' }).getByTestId('resolved-chip')).toHaveCount(0)
    await expect(headerCount(page)).toHaveText('2')

    // The overview aggregates the active state only, never the buffer entry.
    await page.getByRole('button', { name: 'Open alerts overview' }).click()
    await expect(page.getByText('Top label values across 2 alerts')).toBeVisible()
    await page.keyboard.press('Escape')

    await page.reload()
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(entry(page, 'rr-resolved-mid')).toBeVisible()

    await toggle(page).click()
    await expect(entry(page, 'rr-resolved-mid')).toHaveCount(0)
  })

  test('the resolved entry sits between the active ones by startsAt, exactly like active alerts', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await seed(am, jarvis, [activeNew, activeOld], [resolvedMid])
    await openAlerts(page, 'card', false) // flat grid: one card per alert, in list order
    await toggle(page).click()

    const order = async () => (await page.getByTestId('alert-card').allTextContents())
      .map((t) => ['rr-active-new', 'rr-resolved-mid', 'rr-active-old'].find((s) => t.includes(s)))
    await expect.poll(order).toEqual(['rr-active-new', 'rr-resolved-mid', 'rr-active-old'])
  })

  test('a resolved entry adds no silence action: the number of silence bells is the same with the toggle on', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await seed(am, jarvis, [activeNew], [resolvedMid])
    await openAlerts(page, 'card')

    const bells = page.getByLabel(/^Silence options for/)
    await expect(entry(page, 'rr-active-new')).toBeVisible()
    const before = await bells.count()
    expect(before).toBeGreaterThan(0)

    await toggle(page).click()
    await expect(entry(page, 'rr-resolved-mid')).toBeVisible()
    await expect(bells).toHaveCount(before)
  })

  test('list view: a group made only of resolved alerts has no silence actions', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await seed(am, jarvis, [activeNew], [resolvedMid])
    await openAlerts(page, 'list')
    await toggle(page).click()

    const resolvedGroup = page.getByTestId('alert-group-row').filter({ hasText: 'RrResolvedMid' })
    const activeGroup = page.getByTestId('alert-group-row').filter({ hasText: 'RrActiveNew' })
    await expect(resolvedGroup).toBeVisible()
    await expect(activeGroup.getByRole('button', { name: 'Silence group' })).toBeVisible()
    await expect(resolvedGroup.getByRole('button', { name: 'Silence group' })).toHaveCount(0)
  })

  test('list view: "Silence group" of a mixed group covers only its active alerts (narrow matchers, resolved not counted)', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    // Same alertname; they differ in "instance", so a form built from BOTH alerts would drop that
    // matcher and widen the silence to the resolved one as well.
    const mixedActive: AlertInput = { labels: { alertname: 'RrMixed', severity: 'critical', instance: 'inst-a' }, annotations: { summary: 'rr-mixed-active' }, startsAt: minutesAgo(30) }
    const mixedResolved: AlertInput = { labels: { alertname: 'RrMixed', severity: 'critical', instance: 'inst-b' }, annotations: { summary: 'rr-mixed-resolved' }, startsAt: minutesAgo(20) }
    await seed(am, jarvis, [mixedActive], [mixedResolved])
    await openAlerts(page, 'list')
    await toggle(page).click()

    const group = page.getByTestId('alert-group-row').filter({ hasText: 'RrMixed' })
    await expect(group).toBeVisible()
    await group.getByRole('button', { name: 'Silence group' }).click()

    const dialog = page.getByRole('dialog', { name: 'Create silence' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('inst-a', { exact: true })).toBeVisible()
    await expect(dialog.getByText('inst-b', { exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: /affected alerts/ })).toHaveText(/^1\s*affected alerts/)
  })

  test('only resolved entries: shown while the toggle is on, the empty state returns when it is off', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await seed(am, jarvis, [], [resolvedMid])
    await openAlerts(page, 'card')
    await expect(page.getByTestId('alert-card')).toHaveCount(0)

    await toggle(page).click()
    await expect(entry(page, 'rr-resolved-mid')).toBeVisible()
    await expect(headerCount(page)).toHaveText('0')

    await toggle(page).click()
    await expect(page.getByTestId('alert-card')).toHaveCount(0)
  })

  test('a resolved member does not move its group in the grouped card view', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    // "RrShared" = one old active + one very recent resolved; "RrOther" is active and newer than the old one.
    const sharedActive: AlertInput = { labels: { alertname: 'RrShared', severity: 'critical', instance: 'a' }, annotations: { summary: 'rr-shared-active' }, startsAt: minutesAgo(40) }
    const sharedResolved: AlertInput = { labels: { alertname: 'RrShared', severity: 'critical', instance: 'b' }, annotations: { summary: 'rr-shared-resolved' }, startsAt: minutesAgo(2) }
    const other: AlertInput = { labels: { alertname: 'RrOther', severity: 'critical' }, annotations: { summary: 'rr-other' }, startsAt: minutesAgo(15) }
    await seed(am, jarvis, [sharedActive, other], [sharedResolved])
    await openAlerts(page, 'card')

    const order = async () => (await page.getByTestId('alert-card').allTextContents())
      .filter((t) => /rr-other|rr-shared-active/.test(t))
      .map((t) => (t.includes('rr-other') ? 'other' : 'shared'))
    await expect.poll(order).toEqual(['other', 'shared'])
    await toggle(page).click()
    await expect(entry(page, 'rr-shared-resolved')).toBeVisible()
    await expect.poll(order).toEqual(['other', 'shared'])
  })

  test('the toggle is a compact icon button and does not widen or wrap the toolbar', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await seed(am, jarvis, [activeNew], [resolvedMid])
    await page.setViewportSize({ width: 900, height: 800 })
    await openAlerts(page, 'card')

    const box = await toggle(page).boundingBox()
    expect(box?.width).toBe(28)
    expect(box?.height).toBe(28)
    await toggle(page).hover()
    await expect(page.getByRole('tooltip')).toHaveText('Show recently resolved alerts (kept for 20 minutes)')
    await toggle(page).click()
    await toggle(page).hover()
    await expect(page.getByRole('tooltip')).toHaveText('Hide recently resolved alerts (kept for 20 minutes)')
    await toggle(page).click()
    await expect(toggle(page)).toHaveText('')

    // Same toolbar height without the toggle (Suppressed tab) -> it did not force a wrap.
    const toolbar = page.getByTestId('alerts-toolbar')
    const withToggle = (await toolbar.boundingBox())!.height
    await page.getByRole('button', { name: 'Suppressed' }).click()
    await expect(toggle(page)).toHaveCount(0)
    expect((await toolbar.boundingBox())!.height).toBe(withToggle)
  })

  test('group badge adds "+ M resolved" only for a mixed group while the toggle is on', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    const grp = (instance: string): AlertInput => ({ labels: { alertname: 'RrCount', severity: 'critical', instance }, annotations: { summary: `rr-count-${instance}` }, startsAt: minutesAgo(30) })
    await seed(am, jarvis, [grp('a1'), grp('a2')], [{ ...grp('r1'), startsAt: minutesAgo(20) }])

    // Card view
    await openAlerts(page, 'card')
    const card = page.getByTestId('alert-group-card').filter({ hasText: 'RrCount' })
    await expect(card).toContainText('×2')
    await expect(card).not.toContainText(/\d\s*resolved/)
    await toggle(page).click()
    await expect(card).toContainText('×2 + 1 resolved')
    await toggle(page).click()
    await expect(card).not.toContainText(/\d\s*resolved/)

    // List view
    await page.getByRole('button', { name: 'List View' }).click()
    const row = page.getByTestId('alert-group-row').filter({ hasText: 'RrCount' })
    await expect(row).not.toContainText(/\d\s*resolved/)
    await toggle(page).click()
    await expect(row).toContainText('2 + 1 resolved')
    // Nothing is counted in the header.
    await expect(headerCount(page)).toHaveText('2')
  })

  test('dimming: a lone resolved alert, a resolved member of a mixed group and an all-resolved group', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    const mk = (alertname: string, instance: string, minutes: number): AlertInput => ({ labels: { alertname, severity: 'critical', instance }, annotations: { summary: `rr-${alertname}-${instance}` }, startsAt: minutesAgo(minutes) })
    const lone = mk('RrLone', 'x', 50)
    const mixedActive = mk('RrMix', 'a', 45)
    const mixedResolved = mk('RrMix', 'r', 44)
    const allA = mk('RrAll', 'r1', 43)
    const allB = mk('RrAll', 'r2', 42)
    await seed(am, jarvis, [mixedActive], [lone, mixedResolved, allA, allB])
    await openAlerts(page, 'card')
    await toggle(page).click()

    const groupOf = (name: string) => page.getByTestId('alert-group-card').filter({ hasText: name })
    const entryOf = (summary: string) => page.getByTestId('alert-card').filter({ hasText: summary })

    // Lone resolved alert: its entry and its (size-1) card are marked.
    await expect(entryOf('rr-RrLone-x')).toHaveAttribute('data-resolved', 'true')
    await expect(groupOf('RrLone')).toHaveAttribute('data-resolved', 'true')
    // Mixed group: only the resolved entry, not the group and not the active entry.
    await expect(entryOf('rr-RrMix-r')).toHaveAttribute('data-resolved', 'true')
    await expect(entryOf('rr-RrMix-a')).toHaveAttribute('data-resolved', 'false')
    await expect(groupOf('RrMix')).toHaveAttribute('data-resolved', 'false')
    // All-resolved group: the whole card.
    await expect(groupOf('RrAll')).toHaveAttribute('data-resolved', 'true')

    // List view: the same three cases on group rows and rows.
    await page.getByRole('button', { name: 'List View' }).click()
    await expect(page.getByTestId('alert-group-row').filter({ hasText: 'RrLone' })).toHaveAttribute('data-resolved', 'true')
    await expect(page.getByTestId('alert-group-row').filter({ hasText: 'RrAll' })).toHaveAttribute('data-resolved', 'true')
    const mixRow = page.getByTestId('alert-group-row').filter({ hasText: 'RrMix' })
    await expect(mixRow).toHaveAttribute('data-resolved', 'false')
    await mixRow.click()
    const rows = page.getByTestId('alert-list-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.filter({ has: page.getByText('Resolved', { exact: true }) })).toHaveAttribute('data-resolved', 'true')
    await expect(rows.filter({ hasNot: page.getByText('Resolved', { exact: true }) })).toHaveAttribute('data-resolved', 'false')
  })

  test('no extra status column or "mixed" state appears in the Active tab', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    const grp = (instance: string): AlertInput => ({ labels: { alertname: 'RrCol', severity: 'critical', instance }, annotations: { summary: `rr-col-${instance}` }, startsAt: minutesAgo(30) })
    await seed(am, jarvis, [grp('a')], [{ ...grp('r'), startsAt: minutesAgo(20) }])
    await openAlerts(page, 'list')
    await toggle(page).click()
    await expect(page.getByTestId('alert-group-row').filter({ hasText: 'RrCol' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'State' })).toHaveCount(0)
    await expect(page.getByText('mixed', { exact: true })).toHaveCount(0)
  })

  test('mixed card: only the resolved entry carries the Resolved chip, as first chip of its label row', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    const mk = (instance: string, m: number): AlertInput => ({ labels: { alertname: 'RrChip', severity: 'critical', instance }, annotations: { summary: `rr-chip-${instance}` }, startsAt: minutesAgo(m) })
    await seed(am, jarvis, [mk('a', 30)], [mk('r', 20)])
    await openAlerts(page, 'card')
    await toggle(page).click()
    await expect(entry(page, 'rr-chip-r').getByTestId('resolved-chip')).toHaveCount(1)
    await expect(entry(page, 'rr-chip-a').getByTestId('resolved-chip')).toHaveCount(0)
    // No group-level marker: the group card itself is not resolved.
    await expect(page.getByTestId('alert-group-card').filter({ hasText: 'RrChip' })).toHaveAttribute('data-resolved', 'false')
  })

  test('list view: the Resolved chip leads the label row of a resolved row', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    const mk = (instance: string, m: number): AlertInput => ({ labels: { alertname: 'RrListChip', severity: 'critical', instance }, annotations: { summary: `rr-lc-${instance}` }, startsAt: minutesAgo(m) })
    await seed(am, jarvis, [mk('a', 30)], [mk('r', 20)])
    await openAlerts(page, 'list')
    await toggle(page).click()
    await page.getByTestId('alert-group-row').filter({ hasText: 'RrListChip' }).click()
    const rows = page.getByTestId('alert-list-row')
    await expect(rows).toHaveCount(2)
    const resolvedRow = rows.filter({ has: page.getByTestId('resolved-chip') })
    await expect(resolvedRow).toHaveCount(1)
    await expect(resolvedRow).toHaveAttribute('data-resolved', 'true')
  })

  test('detail sheet of a recently resolved alert: banner and Silence button; the chip is no real label', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await seed(am, jarvis, [activeNew], [resolvedMid])
    await openAlerts(page, 'card')
    await toggle(page).click()
    await entry(page, 'rr-resolved-mid').getByTestId('alert-open-details').click()

    const panel = page.getByTestId('detail-panel')
    await expect(panel.getByTestId('detail-resolved-banner')).toContainText(/Resolved .* ago/)
    await expect(panel.getByTestId('detail-resolved-banner')).toContainText('fired for')
    await expect(panel.getByRole('button', { name: 'Silence', exact: true })).toBeVisible()
    // Not a label: absent from the panel's label list, the silence form's matchers and the label filter.
    await expect(panel.getByTestId('detail-label-item').filter({ hasText: /^Resolved/ })).toHaveCount(0)
    await expect(panel.getByTestId('resolved-chip')).toHaveCount(0)
    await panel.getByRole('button', { name: 'Silence', exact: true }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: 'Create new silence' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('resolved-chip')).toHaveCount(0)
    await expect(dialog.getByText('Resolved', { exact: true })).toHaveCount(0)
  })

  test('detail sheet of a Resolved-tab (history) alert: banner and Silence button as well', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await seed(am, jarvis, [], [resolvedMid])
    await openAlerts(page, 'list')
    await page.goto('/?state=resolved')
    await page.getByTestId('alert-list-row').first().click()
    const panel = page.getByTestId('detail-panel')
    await expect(panel.getByTestId('detail-resolved-banner')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Silence', exact: true })).toBeVisible()
  })

  test('tooltips explain the window: Resolved segment (history), toggle; the Resolved label has none', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await seed(am, jarvis, [activeNew], [resolvedMid])
    await openAlerts(page, 'card')
    await toggle(page).click()
    await page.getByTestId('resolved-chip').first().hover()
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await page.getByRole('button', { name: 'Resolved', exact: true }).hover()
    await expect(page.getByRole('tooltip')).toHaveText("Resolved alerts (history). Alerts that resolved recently also stay in the Active view for 20 minutes when 'Recently resolved' is on.")
  })

  test('card entry: start time left, resolve time on the same row (right)', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await seed(am, jarvis, [activeNew], [resolvedMid])
    await openAlerts(page, 'card')
    await toggle(page).click()
    const e = entry(page, 'rr-resolved-mid')
    await expect(e.getByTestId('alert-resolved-at')).toBeVisible()
    // Layout settles as stats and the sparkline load: poll the geometry instead of sampling once.
    await expect.poll(async () => {
      const start = await e.getByTestId('alert-start-time').boundingBox()
      const resolvedAt = await e.getByTestId('alert-resolved-at').boundingBox()
      if (!start || !resolvedAt) return 'missing'
      return Math.abs(start.y - resolvedAt.y) < 6 && resolvedAt.x > start.x + start.width ? 'same-row' : `dy=${Math.round(resolvedAt.y - start.y)} dx=${Math.round(resolvedAt.x - start.x)}`
    }).toBe('same-row')
  })

  test('card: the resolve time comes from the live entry, not from (possibly stale) alert stats', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await seed(am, jarvis, [activeNew], [resolvedMid])
    await page.route('**/api/v1/alerts/*/stats*', async (route) => {
      const res = await route.fetch()
      const body = await res.json()
      await route.fulfill({ response: res, json: { ...body, lastResolvedAt: '2001-01-01T00:00:00Z' } })
    })
    await openAlerts(page, 'card')
    await toggle(page).click()
    const at = entry(page, 'rr-resolved-mid').getByTestId('alert-resolved-at')
    await expect(at).toBeVisible()
    await expect(at).not.toHaveAttribute('title', /2001/)
  })

  test('dimming recolours text of resolved entries only: chips follow muted-foreground there, not in the Resolved tab', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await seed(am, jarvis, [activeNew], [resolvedMid])
    await openAlerts(page, 'card')
    await toggle(page).click()
    const colorOf = (loc: import('@playwright/test').Locator) => loc.evaluate((el) => getComputedStyle(el).color)
    // A label chip is text-foreground; inside it the key is text-muted-foreground. In a resolved entry both read muted.
    const chipOf = (card: import('@playwright/test').Locator) => card.getByTestId('alert-card-common-labels').locator('span.truncate').filter({ hasText: 'team:' }).first()
    const resolvedChip = chipOf(page.getByTestId('alert-group-card').filter({ hasText: 'RrResolvedMid' }))
    const activeChip = chipOf(page.getByTestId('alert-group-card').filter({ hasText: 'RrActiveNew' }))
    expect(await colorOf(resolvedChip)).toBe(await colorOf(resolvedChip.locator('span').first()))
    expect(await colorOf(activeChip)).not.toBe(await colorOf(activeChip.locator('span').first()))

    // Resolved tab (history): chips keep their normal foreground.
    await page.getByRole('button', { name: 'Resolved', exact: true }).click()
    const row = page.getByTestId('alert-list-row').first()
    await expect(row).toBeVisible()
    await expect(row).toHaveAttribute('data-resolved', 'false')
    const histChip = row.locator('span.truncate').filter({ hasText: 'team:' }).first()
    expect(await colorOf(histChip)).not.toBe(await colorOf(histChip.locator('span').first()))
  })

  test('the window in the tooltips follows the instance setting (90 minutes)', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await seed(am, jarvis, [activeNew], [resolvedMid])
    await page.route('**/api/v1/status', async (route) => {
      const res = await route.fetch()
      await route.fulfill({ response: res, json: { ...(await res.json()), resolved_buffer_ttl_seconds: 5400 } })
    })
    await openAlerts(page, 'card')
    await toggle(page).hover()
    await expect(page.getByRole('tooltip')).toHaveText('Show recently resolved alerts (kept for 90 minutes)')
    await page.getByRole('button', { name: 'Resolved', exact: true }).hover()
    await expect(page.getByRole('tooltip')).toContainText('for 90 minutes')
  })

  test('list row: the Resolved chip is the first element of the chip row', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    const mk = (instance: string, m: number): AlertInput => ({ labels: { alertname: 'RrFirst', severity: 'critical', instance }, annotations: { summary: `rr-first-${instance}` }, startsAt: minutesAgo(m) })
    await seed(am, jarvis, [mk('a', 30)], [mk('r', 20)])
    await openAlerts(page, 'list')
    await toggle(page).click()
    await page.getByTestId('alert-group-row').filter({ hasText: 'RrFirst' }).click()
    const chip = page.getByTestId('alert-list-row').getByTestId('resolved-chip')
    await expect(chip).toHaveCount(1)
    // the chip must be the first child of its chip row
    expect(await chip.evaluate((el) => el.parentElement!.firstElementChild === el)).toBe(true)
  })

  test('mixed card header: the group bell covers only the active alerts', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    const grp = (instance: string, m: number): AlertInput => ({ labels: { alertname: 'RrBell', severity: 'critical', instance }, annotations: { summary: `rr-bell-${instance}` }, startsAt: minutesAgo(m) })
    await seed(am, jarvis, [grp('a1', 30), grp('a2', 29)], [grp('r1', 20)])
    await openAlerts(page, 'card')
    await toggle(page).click()
    const card = page.getByTestId('alert-group-card').filter({ hasText: 'RrBell' })
    await expect(card.getByLabel('Silence options for 2 alerts')).toHaveCount(1)
    await expect(card.getByLabel('Silence options for 3 alerts')).toHaveCount(0)
  })

  test('the detail banner is keyboard-focusable and shows its tooltip on focus', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await seed(am, jarvis, [activeNew], [resolvedMid])
    await openAlerts(page, 'card')
    await toggle(page).click()
    await entry(page, 'rr-resolved-mid').getByTestId('alert-open-details').click()
    await page.getByTestId('detail-resolved-banner').focus()
    await expect(page.getByRole('tooltip')).toBeVisible()
  })
})
