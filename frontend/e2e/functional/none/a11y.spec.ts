import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { kubernetesAlerts } from '../../fixtures/alerts'

/**
 * Automated accessibility checks (docs/design-system.md → Accessibility): an axe scan of the two
 * main pages in both themes, and the reduced-motion rule. axe finds roughly a third of WCAG
 * issues — it does not replace the manual screen-reader pass, but it stops regressions in
 * names, roles, labels and contrast.
 */

async function openInTheme(page: Page, theme: 'dark' | 'light', activePage: 'alerts' | 'silences') {
  // The app starts dark and switches to the stored theme on load; with colour transitions running,
  // axe would measure a half-faded button. Reduced motion (our own rule) switches transitions off.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(
    ({ theme, activePage }) => {
      localStorage.setItem(
        'jarvis-user-settings',
        JSON.stringify({ state: { theme, timeFormat: 'relative', defaultViewMode: 'card', resolvedPageSize: 25, defaultSilenceDurationMinutes: 60, defaultCreatorName: '', claimAnimationEnabled: true }, version: 0 }),
      )
      localStorage.setItem('jarvis-ui', JSON.stringify({ state: { activePage, filters: { state: 'active', search: '', labelMatchers: [] } }, version: 0 }))
    },
    { theme, activePage },
  )
  await page.goto('/?state=active')
  // Measure only once the stored theme is applied and settled, not mid-switch from the dark default.
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await page.waitForTimeout(300)
}

async function scan(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .flatMap((v) => [
      `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`,
      ...v.nodes.slice(0, 6).map((n) => {
        const d = (n.any[0]?.data ?? {}) as { fgColor?: string; bgColor?: string; contrastRatio?: number }
        const c = d.contrastRatio ? ` [${d.fgColor} on ${d.bgColor} = ${d.contrastRatio}]` : ''
        return `    ${n.target.join(' ')}${c} :: ${n.html.slice(0, 110)}`
      }),
    ])
}

for (const theme of ['dark', 'light'] as const) {
  test(`axe: alerts page has no serious violations (${theme})`, async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)
    await openInTheme(page, theme, 'alerts')
    await expect(page.getByTestId('alert-card').first()).toBeVisible()
    expect(await scan(page)).toEqual([])
  })

  test(`axe: silences page has no serious violations (${theme})`, async ({ page }) => {
    await dismissNoAuthNotice(page)
    await openInTheme(page, theme, 'silences')
    await expect(page.getByRole('button', { name: 'Create silence' }).first()).toBeVisible()
    expect(await scan(page)).toEqual([])
  })
}

test('A13 the alert card opens from the keyboard through a named button, not a role="button" wrapper', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)
  await page.goto('/?state=active')

  const card = page.getByTestId('alert-card').first()
  await expect(card).toBeVisible()

  // The wrapper is a plain container again: a role="button" here would swallow the
  // nested action buttons into one flattened accessible name (axe: nested-interactive).
  await expect(card).not.toHaveAttribute('role', 'button')
  await expect(card).not.toHaveAttribute('tabindex', '0')

  // The card's own affordance is a real button, so the panel is reachable without a mouse.
  const open = card.getByRole('button', { name: /^Open details for / })
  await open.focus()
  await expect(open).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('detail-panel')).toBeVisible()
})

test('A14 the fast-silence popover is a named group of plain buttons, not an ARIA menu', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)
  await page.goto('/?state=active')

  const trigger = page.getByTestId('alert-ack-button').first()
  await expect(trigger).toBeVisible()
  await trigger.focus()
  await page.keyboard.press('Enter')

  const menu = page.getByTestId('alert-ack-menu')
  await expect(menu).toBeVisible()

  // role="menu"/"menuitem" promises arrow-key navigation and owned menuitem children that this
  // popover does not implement — and its options sit inside a heading/grid wrapper, so they
  // are not even owned children. A named group of ordinary buttons is the honest markup.
  await expect(menu).not.toHaveAttribute('role', 'menu')
  await expect(menu).toHaveAttribute('role', 'group')
  await expect(menu).toHaveAttribute('aria-label', /.+/)
  await expect(menu.getByTestId('alert-ack-option').first()).not.toHaveAttribute('role', 'menuitem')
})

test('A15 the fast-silence popover is operable from the keyboard: Tab reaches the options, Escape returns focus', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)
  await page.goto('/?state=active')

  const trigger = page.getByTestId('alert-ack-button').first()
  await expect(trigger).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')

  // Merely tabbing onto the trigger must not open the popover: with several cards on the page a
  // keyboard user would otherwise have to tab through every open panel to get past each one.
  await trigger.focus()
  await expect(page.getByTestId('alert-ack-menu')).toBeHidden()

  await page.keyboard.press('Enter')
  const menu = page.getByTestId('alert-ack-menu')
  await expect(menu).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')

  // The panel lives inside the trigger's subtree, so Tab walks straight into it: first the
  // "Silence…" entry, then the duration options.
  await page.keyboard.press('Tab')
  await expect(menu.getByTestId('alert-ack-open-form')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(menu.getByTestId('alert-ack-option').first()).toBeFocused()

  // Escape closes it and hands focus back to the trigger.
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')

  // Enter toggles it shut again from the keyboard.
  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
})

test('A16 in the list view Enter on a button inside a group or alert row acts on that button only', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)
  await page.goto('/?state=active')
  await page.getByTitle('List View').click()

  // The list groups by alertname: alert rows only exist once their group row is expanded.
  const groupRow = page.getByTestId('alert-group-row').first()
  await expect(groupRow).toBeVisible()
  await expect(page.getByTestId('alert-list-row')).toHaveCount(0)

  // A group row expands on Enter, and it holds real buttons ("Silence group"). Enter on such a
  // button must not also toggle the group behind it — one key press, one action.
  await groupRow.getByRole('button', { name: 'Silence group' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('alert-list-row')).toHaveCount(0)

  // The group row itself still expands from the keyboard when it is the focused element.
  await page.keyboard.press('Escape')
  await groupRow.focus()
  await page.keyboard.press('Enter')
  const row = page.getByTestId('alert-list-row').first()
  await expect(row).toBeVisible()

  // Same for an alert row: its Fast-Silence trigger sits inside it, and the row opens the detail
  // panel on Enter. A key press on that button must not also reach the row.
  await row.getByTestId('alert-ack-button').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('alert-ack-menu')).toBeVisible()
  await expect(page.getByTestId('detail-panel')).toBeHidden()

  await page.keyboard.press('Escape')
  await row.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('detail-panel')).toBeVisible()
})

test('reduced motion stops decorative animations but keeps spinners turning', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await dismissNoAuthNotice(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Refresh now' })).toBeVisible()

  const names = await page.evaluate(() => {
    const probe = (cls: string) => {
      const el = document.createElement('div')
      el.className = cls
      document.body.appendChild(el)
      const name = getComputedStyle(el).animationName
      el.remove()
      return name
    }
    return { ping: probe('animate-ping'), spin: probe('animate-spin') }
  })
  expect(names.ping).toBe('none')
  expect(names.spin).not.toBe('none')
})
