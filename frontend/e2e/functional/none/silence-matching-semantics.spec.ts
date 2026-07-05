import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import type { Page, Locator } from '@playwright/test'

const AM_URL = process.env.E2E_ALERTMANAGER_URL ?? 'http://localhost:9094'

/**
 * Differential tests against a REAL Alertmanager: what the silence-form
 * preview claims will be affected must match what Alertmanager actually
 * suppresses after the silence is created. This is the class of bug from
 * tmp/fable/review_silence.md (S-01) that unit tests against a fake
 * reference implementation can't catch on their own — only Alertmanager
 * itself is authoritative on its own matching semantics.
 */

async function clearAllAMSilences(): Promise<void> {
  const res = await fetch(`${AM_URL}/api/v2/silences`)
  if (!res.ok) return
  const silences = (await res.json()) as Array<{ id: string; status?: { state?: string } }>
  for (const silence of silences) {
    if (silence.status?.state !== 'expired') {
      await fetch(`${AM_URL}/api/v2/silence/${silence.id}`, { method: 'DELETE' })
    }
  }
}

async function openSilenceForm(page: Page) {
  await page.getByRole('button', { name: 'Create silence' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Create silence' })
  await expect(dialog).toBeVisible({ timeout: 5_000 })
  return dialog
}

/** Fills the label name of the first (only) matcher row. */
async function fillSilenceLabel(dialog: Locator, labelName: string) {
  const labelBtn = dialog.getByRole('button', { name: 'label' }).first()
  await labelBtn.click()
  const searchInput = dialog.getByPlaceholder('Search…').first()
  await searchInput.fill(labelName)
  await searchInput.press('Enter')
}

/** The value input of the first matcher row (TagValueInput's internal input). */
function getValueInput(dialog: Locator): Locator {
  return dialog.locator('.flex.min-h-8 input').first()
}

async function selectOperator(dialog: Locator, operator: '=' | '!=' | '=~' | '!~') {
  await dialog.locator('select').first().selectOption(operator)
}

function matchBadge(dialog: Locator): Locator {
  return dialog.locator('button').filter({ hasText: /affected alerts/ }).first()
}

async function matchCount(dialog: Locator): Promise<number> {
  const text = await matchBadge(dialog).textContent()
  return parseInt(text?.match(/\d+/)?.[0] ?? '0', 10)
}

async function fillAuthorReasonAndSubmit(dialog: Locator, reason: string) {
  // Pin an explicit duration rather than relying on the ambient default —
  // these tests assert real Alertmanager suppression a few seconds/polls
  // later and must not race a short-lived silence.
  await dialog.getByRole('button', { name: '1h', exact: true }).click()
  await dialog.getByPlaceholder('Your name').fill('e2e-semantics')
  await dialog.getByPlaceholder('Reason for the silence…').fill(reason)
  await dialog.getByRole('button', { name: 'Preview' }).click()
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog.getByText('Silence submitted')).toBeVisible({ timeout: 10_000 })
}

/** Fetches an alert's status.state from Jarvis's own API by a label match (assumes uniqueness). */
async function alertState(instance: string): Promise<string | undefined> {
  const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
  const alerts = (await res.json()) as Array<{ labels: Record<string, string>; status: { state: string } }>
  return alerts.find((a) => a.labels.instance === instance)?.status.state
}

test.describe('Silence matching semantics (Alertmanager parity — S-01)', () => {
  test.afterEach(async () => {
    await clearAllAMSilences()
  })

  test('anchored =~ "web1" matches only web1, not web10 (preview agrees with Alertmanager)', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire([
      { labels: { alertname: 'AnchorRegexTest', instance: 'web1' } },
      { labels: { alertname: 'AnchorRegexTest', instance: 'web10' } },
    ])
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 2)

    await page.goto('/')
    const dialog = await openSilenceForm(page)

    await fillSilenceLabel(dialog, 'instance')
    await selectOperator(dialog, '=~')
    const valueInput = getValueInput(dialog)
    await valueInput.fill('web1')
    await valueInput.press('Enter')

    await expect(matchBadge(dialog)).toBeVisible({ timeout: 8_000 })
    // The core regression check: an unanchored (substring) implementation would report
    // 2 here, since "web1" is a substring of "web10" — Alertmanager's anchored match
    // silences only the exact "web1" instance.
    await expect.poll(() => matchCount(dialog)).toBe(1)

    await fillAuthorReasonAndSubmit(dialog, 'S-01 anchored =~ regression test')
    await jarvis.poll()

    await expect.poll(() => alertState('web1'), { timeout: 10_000 }).toBe('suppressed')
    await expect.poll(() => alertState('web10'), { timeout: 10_000 }).toBe('active')
  })

  test('anchored !~ "web" DOES match "web1" — the fatal over-silencing case from the review', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire([{ labels: { alertname: 'AnchorNegRegexTest', instance: 'web1' } }])
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

    await page.goto('/')
    const dialog = await openSilenceForm(page)

    await fillSilenceLabel(dialog, 'instance')
    await selectOperator(dialog, '!~')
    const valueInput = getValueInput(dialog)
    await valueInput.fill('web')
    await valueInput.press('Enter')

    await expect(matchBadge(dialog)).toBeVisible({ timeout: 8_000 })
    // Before the S-01 fix, an unanchored implementation reported 0 here (substring "web"
    // found inside "web1", so "!~ web" looked like "no match") while Alertmanager's
    // anchored ^(?:web)$ does not match "web1", making the negative matcher true — it
    // silenced the alert anyway. A silence created from a preview showing "0 affected"
    // that actually suppresses alerts is exactly the dangerous case this guards against.
    await expect.poll(() => matchCount(dialog)).toBe(1)

    await fillAuthorReasonAndSubmit(dialog, 'S-01 anchored !~ regression test')
    await jarvis.poll()

    await expect.poll(() => alertState('web1'), { timeout: 10_000 }).toBe('suppressed')
  })

  test('regex-OR matcher with metacharacter label values matches only the listed literals, not lookalikes', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire([
      { labels: { alertname: 'EscapeRegexTest', instance: '10.0.0.1' } },
      { labels: { alertname: 'EscapeRegexTest', instance: '10.0.0.2' } },
      // Decoy: if "." in the tag values were left unescaped (matching ANY character
      // instead of a literal dot), the "10.0.0.1" pattern would also match this.
      { labels: { alertname: 'EscapeRegexTest', instance: '10a0b0c1' } },
    ])
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 3)

    await page.goto('/')
    const dialog = await openSilenceForm(page)

    await fillSilenceLabel(dialog, 'instance')
    await selectOperator(dialog, '=~')
    const valueInput = getValueInput(dialog)
    await valueInput.fill('10.0.0.1')
    await valueInput.press('Enter')
    await valueInput.fill('10.0.0.2')
    await valueInput.press('Enter')

    await expect(matchBadge(dialog)).toBeVisible({ timeout: 8_000 })
    await expect.poll(() => matchCount(dialog)).toBe(2)

    await fillAuthorReasonAndSubmit(dialog, 'S-01 regex-OR escaping regression test')
    await jarvis.poll()

    await expect.poll(() => alertState('10.0.0.1'), { timeout: 10_000 }).toBe('suppressed')
    await expect.poll(() => alertState('10.0.0.2'), { timeout: 10_000 }).toBe('suppressed')
    await expect.poll(() => alertState('10a0b0c1'), { timeout: 10_000 }).toBe('active')
  })
})
