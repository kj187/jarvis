import type { Page } from '@playwright/test'
import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { fireWithHeatmapHistory } from '../../support/heatmapHistory'
import { screenshotAlerts, hideTestSuiteLabel } from '../../support/screenshotData'
import type { AlertmanagerClient } from '../../support/alertmanager'
import type { JarvisClient } from '../../support/jarvis'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshots for the documentation site's landing-page product tour — each
 * scene needs a dark and a light PNG (the site picks the one matching its
 * theme). Same polished fixture as card-view: past `startsAt`, a realistic
 * cluster name, no `test_suite` housekeeping label.
 * Regenerate: make e2e-screenshot NAME=home-tour
 */

async function switchToLightMode(page: Page): Promise<void> {
  await page.getByTestId('user-menu').hover()
  await page.getByRole('button', { name: 'Light mode' }).click()
  await page.mouse.move(0, 0) // let the hover-close timer close the dropdown
}

async function fireTourAlerts(
  page: Page,
  am: AlertmanagerClient,
  jarvis: JarvisClient,
): Promise<void> {
  await dismissNoAuthNotice(page)
  await hideTestSuiteLabel(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, screenshotAlerts)
}

/** Alert detail with a claim: who is on it, what they found, firing heatmap. */
async function openClaimedDetail(page: Page, jarvis: JarvisClient, light: boolean): Promise<void> {
  // `hideTestSuiteLabel`'s init script rewrites the persisted settings on every
  // navigation, which would reset the theme — so switch theme first and open
  // the panel by clicking, not by reloading.
  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()
  if (light) await switchToLightMode(page)

  // Backfilled history is random per alert — take the first card (cards are
  // severity-sorted, so a critical one) that shows an "N×" occurrence count,
  // so the detail heatmap isn't an empty grid.
  const card = page.getByTestId('alert-card').filter({ hasText: /\d+×/ }).first()
  await expect(card).toBeVisible()
  const cardText = await card.innerText()

  const res = await page.request.get(`${JARVIS_BASE_URL}/api/v1/alerts`)
  const alerts: Array<{ fingerprint: string; annotations?: Record<string, string> }> = await res.json()
  // The card text has no alertname (it sits in the header) — match on the summary.
  const target = alerts.find((a) => a.annotations?.summary && cardText.includes(a.annotations.summary))
  if (!target) throw new Error('could not match the chosen card to an alert')
  await jarvis.setClaim(target.fingerprint, 'alice-dev', 'Investigating OOMKilled container')

  await card.getByText(target.annotations!.summary, { exact: true }).click()
  await expect(page.getByTestId('detail-panel')).toBeVisible()
  await expect(page.getByTestId('detail-claim-badge')).toBeVisible()
  await page.waitForTimeout(300)
}

/** Silence sheet opened from an alert card: matchers pre-filled from its labels. */
async function openSilenceSheet(page: Page, light: boolean): Promise<void> {
  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()
  if (light) await switchToLightMode(page)

  await page.getByLabel('Silence options for this alert').first().click()
  await page.getByText('Silence…').first().click()
  await expect(page.getByRole('heading', { name: 'Create silence' })).toBeVisible()

  // Drop housekeeping labels that would only add noise to the matcher list.
  const rows = page.locator('div[style*="160px 72px"]')
  for (const name of ['test_suite', 'runbook']) {
    const before = await rows.count()
    await rows.filter({ has: page.getByText(name, { exact: true }) }).locator('> button').click()
    await expect(rows).toHaveCount(before - 1)
  }
  await page.mouse.move(300, 700) // park the pointer on the backdrop, off the remove buttons
  await page.waitForTimeout(300)
}

for (const light of [false, true]) {
  const suffix = light ? '-light' : ''

  test(`home-tour-detail${suffix}`, async ({ page, am, jarvis }) => {
    await fireTourAlerts(page, am, jarvis)
    await openClaimedDetail(page, jarvis, light)
    await page.screenshot({ path: `${DIR}/tour-detail${suffix}.png` })
  })

  test(`home-tour-silences${suffix}`, async ({ page, am, jarvis }) => {
    await fireTourAlerts(page, am, jarvis)
    await openSilenceSheet(page, light)
    await page.screenshot({ path: `${DIR}/tour-silences${suffix}.png` })
  })
}
