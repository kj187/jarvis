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
