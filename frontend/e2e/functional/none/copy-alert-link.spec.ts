import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { kubernetesAlerts } from '../../fixtures/alerts'
import type { Page } from '@playwright/test'

/**
 * The detail panel's "Copy link" button puts a link on the clipboard that opens the very same alert
 * for someone else: only `state` and `alert`, none of the sender's search/filters.
 */

type CopyProbe = Window & { __copied?: string }

async function openFirstAlert(page: Page, url: string) {
  await page.goto(url)
  const card = page.getByTestId('alert-card').first()
  await expect(card).toBeVisible({ timeout: 10_000 })
  await card.click()
  await expect(page.getByTestId('detail-panel')).toBeVisible()
  return (await page.getByTestId('detail-panel').locator('#detail-panel-title').textContent())?.trim() ?? ''
}

async function readCopied(page: Page): Promise<string> {
  await expect.poll(() => page.evaluate(() => (window as CopyProbe).__copied ?? '')).not.toBe('')
  return page.evaluate(() => (window as CopyProbe).__copied ?? '')
}

test.beforeEach(async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)
})

test('C1 Copy link puts a minimal, working link on the clipboard (Clipboard API)', async ({ page, browser }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t: string) => { (window as CopyProbe).__copied = t } },
      configurable: true,
    })
  })
  // The sender has a search and a filter set — neither may leak into the link.
  const alertname = await openFirstAlert(page, '/?state=active&q=a&filter=' + encodeURIComponent('{severity=~".+"}'))

  await page.getByTestId('detail-copy-link').click()
  await expect(page.getByTestId('detail-copy-link')).toContainText('Link copied')

  const copied = new URL(await readCopied(page))
  expect([...copied.searchParams.keys()].sort()).toEqual(['alert', 'state'])

  // A different browser session (no shared state) opens straight onto the same alert.
  const recipient = await browser.newContext()
  const rp = await recipient.newPage()
  await dismissNoAuthNotice(rp)
  await rp.goto(copied.toString())
  const panel = rp.getByTestId('detail-panel')
  await expect(panel).toBeVisible({ timeout: 10_000 })
  await expect(panel.locator('#detail-panel-title')).toHaveText(alertname)
  await recipient.close()
})

test('C2 Copy link also works where the Clipboard API is unavailable (plain http)', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    document.addEventListener('copy', () => {
      const active = document.activeElement
      ;(window as CopyProbe).__copied = active instanceof HTMLTextAreaElement ? active.value : ''
    })
  })
  await openFirstAlert(page, '/?state=active')

  await page.getByTestId('detail-copy-link').click()
  await expect(page.getByTestId('detail-copy-link')).toContainText('Link copied')
  expect(await readCopied(page)).toContain('alert=')
})
