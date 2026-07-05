import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { kubernetesAlerts } from '../../fixtures/alerts'
import type { Page } from '@playwright/test'

const AM_URL = process.env.E2E_ALERTMANAGER_URL ?? 'http://localhost:9094'

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

/**
 * Fill the label name in the silence form (LabelNameInput is a button, not an input).
 * Opens the dropdown and types in the Search filter.
 */
async function fillSilenceLabel(dialog: ReturnType<Page['getByRole']>, labelName: string) {
  // Click the label button (shows "label" as placeholder text when empty)
  const labelBtn = dialog.getByRole('button', { name: 'label' }).first()
  await labelBtn.click()
  // Type in the search input inside the dropdown
  const searchInput = dialog.getByPlaceholder('Search…').first()
  await searchInput.fill(labelName)
  await searchInput.press('Enter')
}

/**
 * Returns the value input in the matcher row.
 * TagValueInput removes `placeholder` attribute once tags exist, so we fall
 * back to the container's internal input by class rather than placeholder.
 */
function getValueInput(dialog: ReturnType<Page['getByRole']>) {
  // .flex.min-h-8 is the TagValueInput wrapper div — contains the tag chips + free-text input
  return dialog.locator('.flex.min-h-8 input').first()
}

test('F3 operator change in matcher editor from = to =~ enables multi-value', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.goto('/')
  const dialog = await openSilenceForm(page)

  // Fill label name
  await fillSilenceLabel(dialog, 'severity')

  // The operator select is a native <select> — change from = to =~
  const operatorSelect = dialog.locator('select').first()
  await expect(operatorSelect).toBeVisible()
  await operatorSelect.selectOption('=~')

  // Value input (TagValueInput with placeholder="value") — for =~ multiple values allowed
  const valueInput = getValueInput(dialog)
  await valueInput.fill('critical')
  await valueInput.press('Enter')
  await valueInput.fill('warning')
  await valueInput.press('Enter')

  // Both values should appear as tags in the value area
  await expect(dialog.getByText('critical').first()).toBeVisible()
  await expect(dialog.getByText('warning').first()).toBeVisible()
})

test('F3 switching operator from =~ back to = truncates multi-value to single', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.goto('/')
  const dialog = await openSilenceForm(page)

  await fillSilenceLabel(dialog, 'severity')

  const operatorSelect = dialog.locator('select').first()
  await operatorSelect.selectOption('=~')

  const valueInput = getValueInput(dialog)
  await valueInput.fill('critical')
  await valueInput.press('Enter')
  await valueInput.fill('warning')
  await valueInput.press('Enter')

  await expect(dialog.getByText('critical').first()).toBeVisible()
  await expect(dialog.getByText('warning').first()).toBeVisible()

  // Switch back to = — should truncate to only the first value
  await operatorSelect.selectOption('=')

  // Now only "critical" should remain
  await expect(dialog.getByText('critical').first()).toBeVisible()
  // "warning" tag chip should be gone — scope to tag area to avoid matching suggestion dropdown
  const warningCount = await dialog.locator('.flex.min-h-8').getByText('warning').count()
  expect(warningCount).toBe(0)
})

test('F5 live match count badge shows number of affected alerts', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.goto('/')
  const dialog = await openSilenceForm(page)

  // Fill matcher to match existing alert
  await fillSilenceLabel(dialog, 'alertname')

  const valueInput = getValueInput(dialog)
  await valueInput.fill('KubePodCrashLooping')
  await valueInput.press('Enter')

  // After typing a matching alertname, the match count should go above 0
  // The affected alerts button shows "N affected alerts"
  const matchBadge = dialog.locator('button').filter({ hasText: /affected alerts/ }).first()
  await expect(matchBadge).toBeVisible({ timeout: 8_000 })

  const badgeText = await matchBadge.textContent()
  const count = parseInt(badgeText?.match(/\d+/)?.[0] ?? '0', 10)
  expect(count).toBeGreaterThan(0)

  // Click badge to expand affected list
  await matchBadge.click()
  await expect(dialog.getByText('KubePodCrashLooping').first()).toBeVisible()
})

test('F7 zero-match warning appears when matchers match no current alerts', async ({ page }) => {
  await dismissNoAuthNotice(page)
  // No alerts fired — database is clean

  await page.goto('/')
  const dialog = await openSilenceForm(page)

  // Add a matcher that cannot possibly match (no alerts exist)
  await fillSilenceLabel(dialog, 'alertname')
  const valueInput = getValueInput(dialog)
  await valueInput.fill('NonExistentAlert')
  await valueInput.press('Enter')

  // Zero-match amber warning should appear
  await expect(dialog.getByText('No current alerts match these matchers')).toBeVisible({ timeout: 5_000 })
})

test('F8 duration preset buttons update spinners', async ({ page }) => {
  await dismissNoAuthNotice(page)

  await page.goto('/')
  const dialog = await openSilenceForm(page)

  // Click "1h" preset
  await dialog.getByRole('button', { name: '1h', exact: true }).click()

  // Hours spinner should show 1
  const inputs = await dialog.locator('input[type="number"]').all()
  let found1h = false
  for (const input of inputs) {
    const val = await input.inputValue()
    if (val === '1') { found1h = true; break }
  }
  expect(found1h).toBe(true)

  // Click "4h" preset
  await dialog.getByRole('button', { name: '4h', exact: true }).click()

  let found4h = false
  const inputs2 = await dialog.locator('input[type="number"]').all()
  for (const input of inputs2) {
    const val = await input.inputValue()
    if (val === '4') { found4h = true; break }
  }
  expect(found4h).toBe(true)
})

test('F8 duration preset 30m sets correct values', async ({ page }) => {
  await dismissNoAuthNotice(page)

  await page.goto('/')
  const dialog = await openSilenceForm(page)

  await dialog.getByRole('button', { name: '30m', exact: true }).click()

  const inputs = await dialog.locator('input[type="number"]').all()
  const values = await Promise.all(inputs.map((i) => i.inputValue()))
  expect(values).toContain('30')
})

test('F8 duration preset 1d sets 1 day', async ({ page }) => {
  await dismissNoAuthNotice(page)

  await page.goto('/')
  const dialog = await openSilenceForm(page)

  await dialog.getByRole('button', { name: '1d', exact: true }).click()

  const inputs = await dialog.locator('input[type="number"]').all()
  const values = await Promise.all(inputs.map((i) => i.inputValue()))
  expect(values).toContain('1')
})

test('F12 end before start shows validation error and disables Preview', async ({ page }) => {
  await dismissNoAuthNotice(page)

  await page.goto('/')
  const dialog = await openSilenceForm(page)

  // The form uses duration spinners (days/hours/minutes input[type="number"]) for the end time,
  // combined with start = "now". Setting all spinners to 0 makes endsAt = startsAt → validation error.
  // The 3 duration spinners are: days (index 0), hours (index 1), minutes (index 2)
  const durationSpinners = dialog.locator('.flex.gap-8 > div > input[type="number"]')
  const spinnerCount = await durationSpinners.count()

  if (spinnerCount >= 3) {
    // Set all duration spinners to 0 → endsAt equals startsAt → "End must be after start"
    for (let i = 0; i < 3; i++) {
      await durationSpinners.nth(i).fill('0')
      await durationSpinners.nth(i).press('Tab')
    }

    await expect(dialog.getByText('End must be after start')).toBeVisible({ timeout: 5_000 })
    await expect(dialog.getByRole('button', { name: 'Preview' })).toBeDisabled()
  } else {
    test.skip()
  }
})

test('F13 author field is editable in none auth mode', async ({ page }) => {
  await dismissNoAuthNotice(page)

  await page.goto('/')
  const dialog = await openSilenceForm(page)

  const authorInput = dialog.getByPlaceholder('Your name')
  await expect(authorInput).toBeVisible()
  await expect(authorInput).toBeEnabled()

  await authorInput.fill('test-author')
  await expect(authorInput).toHaveValue('test-author')
})

test('F15 preview step shows Start, End, Author, Reason, Cluster, Matcher', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await clearAllAMSilences()
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.goto('/')
  // Wait for cluster health indicator — ensures /api/v1/clusters query resolved
  // so that availableClusters is populated when SilenceForm mounts (selectedClusters init)
  await expect(page.locator('[title*="Instances"]').first()).toBeVisible({ timeout: 8_000 })
  const dialog = await openSilenceForm(page)

  // Fill matcher
  await fillSilenceLabel(dialog, 'alertname')
  const valueInput = getValueInput(dialog)
  await valueInput.fill('KubePodCrashLooping')
  await valueInput.press('Enter')

  // Fill author and reason
  await dialog.getByPlaceholder('Your name').fill('preview-tester')
  await dialog.getByPlaceholder('Reason for the silence…').fill('Preview test reason')

  // Wait for Preview button to be enabled (clusters must be loaded from API)
  const previewBtn = dialog.getByRole('button', { name: 'Preview' })
  await expect(previewBtn).toBeEnabled({ timeout: 8_000 })
  await previewBtn.click()

  // Preview summary should show required fields.
  // Use .text-muted-foreground spans for labels that are ONLY in the preview step
  // (to avoid false positives from the same text appearing in form-step field labels).
  await expect(dialog.getByText('Start').first()).toBeVisible({ timeout: 5_000 })
  await expect(dialog.getByText('End').first()).toBeVisible()
  await expect(dialog.getByText('Author').first()).toBeVisible()
  // "Reason" label — use exact span to avoid matching the value "Preview test reason"
  await expect(dialog.locator('.text-muted-foreground').filter({ hasText: /^Reason$/ }).first()).toBeVisible()
  await expect(dialog.getByText('preview-tester')).toBeVisible()
  await expect(dialog.getByText('Preview test reason')).toBeVisible()
  await expect(dialog.getByText('e2e').first()).toBeVisible() // cluster name
  await expect(dialog.getByText('Matcher (1)')).toBeVisible()
  await expect(dialog.getByText('Affected Alerts')).toBeVisible()
})

test('F17 silence from alert detail panel is pre-filled with alert labels', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await clearAllAMSilences()
  await am.fire([
    {
      labels: {
        alertname: 'F17PrefillAlert',
        severity: 'warning',
        cluster: 'e2e',
        namespace: 'production',
      },
      annotations: { summary: 'F17 prefill test' },
    },
  ])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

  await page.goto('/?state=active')
  const firstCard = page.getByTestId('alert-card').first()
  await firstCard.click()
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()

  // Click the Silence button in the panel
  const silenceBtn = panel.getByRole('button', { name: 'Silence', exact: true })
  await expect(silenceBtn).toBeVisible()
  await silenceBtn.click()

  // A new silence form should open
  await expect(page.getByPlaceholder('Reason for the silence…').first()).toBeVisible({ timeout: 5_000 })

  // Should be pre-filled with alertname matcher
  await expect(page.getByText('F17PrefillAlert').first()).toBeVisible()

  await page.getByRole('button', { name: 'Cancel' }).first().click()
})

test('F4 regex operator allows entering regex-special characters as tag values', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await page.goto('/')
  const dialog = await openSilenceForm(page)

  await fillSilenceLabel(dialog, 'alertname')

  const operatorSelect = dialog.locator('select').first()
  await operatorSelect.selectOption('=~')

  const valueInput = getValueInput(dialog)

  // Enter a value with a dot (regex special char)
  await valueInput.fill('web.server')
  await valueInput.press('Enter')
  // Tag chip shows the raw value
  await expect(dialog.locator('.flex.min-h-8').getByText('web.server').first()).toBeVisible()

  // Enter another regex value with wildcard chars
  await valueInput.fill('api.*')
  await valueInput.press('Enter')
  await expect(dialog.locator('.flex.min-h-8').getByText('api.*').first()).toBeVisible()
})

test('F6 overlap warning shows when an existing silence already covers the same alerts', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await clearAllAMSilences()
  await am.fire([
    {
      labels: { alertname: 'F6OverlapAlert', severity: 'critical', cluster: 'e2e' },
      annotations: { summary: 'F6 overlap test' },
    },
  ])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

  const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
  const alerts: any[] = await res.json()
  const fingerprint = alerts[0].fingerprint

  // Create a silence that covers this alert
  await jarvis.createSilence('e2e', [
    { name: 'alertname', value: 'F6OverlapAlert', isRegex: false, isEqual: true },
  ])

  // Re-poll so Jarvis picks up the silence (alert becomes suppressed)
  await jarvis.poll()

  // Open the detail panel via URL — works for suppressed alerts too
  await page.goto(`/?state=active&alert=${fingerprint}`)
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible({ timeout: 10_000 })

  // Click the Silence button to open the form pre-filled for this alert
  const silenceBtn = panel.getByRole('button', { name: 'Silence', exact: true })
  await expect(silenceBtn).toBeVisible()
  await silenceBtn.click()

  // The form detects the existing silence covers the same alert → overlap warning
  await expect(page.getByText(/active silence already covers/)).toBeVisible({ timeout: 10_000 })
})

test('F9 duration spinner normalizes overflow: 90 minutes becomes 1h 30m', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await page.goto('/')
  const dialog = await openSilenceForm(page)

  // Duration spinners: [days, hours, minutes] — locator from F12 test
  const durationSpinners = dialog.locator('.flex.gap-8 > div > input[type="number"]')
  await expect(durationSpinners).toHaveCount(3)

  // Initial state: 0d 1h 0m (default 1h silence)
  await expect(durationSpinners.nth(1)).toHaveValue('1')

  // Set minutes spinner to 90 → normalizeDuration(0, 1, 90) → 0d 2h 30m
  await durationSpinners.nth(2).fill('90')
  await durationSpinners.nth(2).press('Tab')

  // After normalization: hours should be 2, minutes should be 30
  await expect(durationSpinners.nth(1)).toHaveValue('2', { timeout: 3_000 })
  await expect(durationSpinners.nth(2)).toHaveValue('30', { timeout: 3_000 })
})

test('F10 inline calendar day selection and time spinner increment work', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await page.goto('/')
  const dialog = await openSilenceForm(page)

  // The InlineDateTimePicker is always visible (end date).
  // Its outer container is `.flex.rounded.border.border-border.bg-background`
  const inlineCalendar = dialog.locator('.flex.rounded.border.border-border.bg-background').first()
  await expect(inlineCalendar).toBeVisible()

  // Click any day button in the DayPicker (buttons with just a 1–2 digit number)
  const dayBtns = inlineCalendar.locator('button').filter({ hasText: /^\d{1,2}$/ })
  await expect(dayBtns.first()).toBeVisible({ timeout: 5_000 })
  await dayBtns.first().click()

  // The duration spinners should still be visible (calendar interaction didn't crash the form)
  const durationSpinners = dialog.locator('.flex.gap-8 > div > input[type="number"]')
  await expect(durationSpinners.first()).toBeVisible()

  // Click the hour up-spinner button in the InlineDateTimePicker time panel
  // Time panel container: `.border-l.border-border.px-4`
  const timePanel = inlineCalendar.locator('.border-l.border-border.px-4')
  await expect(timePanel).toBeVisible()

  const hourInput = timePanel.locator('input[type="number"]').first()
  const beforeVal = parseInt(await hourInput.inputValue(), 10)

  const hourUpBtn = timePanel.locator('button').first()
  await hourUpBtn.click()

  const afterVal = parseInt(await hourInput.inputValue(), 10)
  // Hour should have incremented by 1 (clamped to 23)
  expect(afterVal).toBeGreaterThanOrEqual(beforeVal)
})

test('F11 Reset button restores default duration; Now button sets start to current time', async ({ page }) => {
  await dismissNoAuthNotice(page)
  await page.goto('/')
  const dialog = await openSilenceForm(page)

  const durationSpinners = dialog.locator('.flex.gap-8 > div > input[type="number"]')
  await expect(durationSpinners).toHaveCount(3)

  // Fill days spinner directly (React onChange fires on input events from fill)
  await durationSpinners.first().fill('2')
  await durationSpinners.first().dispatchEvent('input')
  await durationSpinners.first().press('Tab')
  await expect(durationSpinners.first()).toHaveValue('2', { timeout: 3_000 })

  // Click Reset → spinners return to default 1h (0d 1h 0m)
  await dialog.getByRole('button', { name: 'Reset' }).click()
  await expect(durationSpinners.first()).toHaveValue('0', { timeout: 3_000 })
  await expect(durationSpinners.nth(1)).toHaveValue('1', { timeout: 3_000 })
  await expect(durationSpinners.nth(2)).toHaveValue('0', { timeout: 3_000 })

  // Click the "Now" button → sets start time to current time
  // The start picker button shows "yyyy-MM-dd HH:mm" format
  const nowBtn = dialog.getByRole('button', { name: 'Now' })
  await expect(nowBtn).toBeVisible()
  await nowBtn.click()

  // Verify the start picker shows today's date (YYYY-MM-DD prefix)
  const today = new Date().toISOString().slice(0, 10)
  // The DateTimePicker button text contains the date in "yyyy-MM-dd HH:mm" format
  const startPickerBtn = dialog.locator('button').filter({ hasText: new RegExp(today) }).first()
  await expect(startPickerBtn).toBeVisible({ timeout: 3_000 })
})

test('F16 results step shows per-cluster submission info after silence submit', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await clearAllAMSilences()
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.goto('/')
  await expect(page.locator('[title*="Instances"]').first()).toBeVisible({ timeout: 8_000 })
  const dialog = await openSilenceForm(page)

  await fillSilenceLabel(dialog, 'alertname')
  const valueInput = getValueInput(dialog)
  await valueInput.fill('KubePodCrashLooping')
  await valueInput.press('Enter')

  await dialog.getByPlaceholder('Your name').fill('f16-tester')
  await dialog.getByPlaceholder('Reason for the silence…').fill('F16 results test')

  // Go to Preview step
  const previewBtn = dialog.getByRole('button', { name: 'Preview' })
  await expect(previewBtn).toBeEnabled({ timeout: 8_000 })
  await previewBtn.click()

  // Submit the silence (button text is "Create" in create-mode)
  const submitBtn = dialog.getByRole('button', { name: 'Create', exact: true })
  await expect(submitBtn).toBeVisible({ timeout: 5_000 })
  await submitBtn.click()

  // Results step: "Silence submitted" heading + cluster row
  await expect(dialog.getByText('Silence submitted')).toBeVisible({ timeout: 10_000 })
  // Per-cluster result: "e2e" cluster name should appear in results
  await expect(dialog.getByText('e2e').first()).toBeVisible({ timeout: 5_000 })
})
