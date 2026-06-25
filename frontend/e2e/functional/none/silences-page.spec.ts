import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import type { Page } from '@playwright/test'

const AM_URL = process.env.E2E_ALERTMANAGER_URL ?? 'http://localhost:9094'

async function waitForSilences(baseURL: string, expectedMin: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${baseURL}/api/v1/silences`)
    if (res.ok) {
      const silences = (await res.json()) as unknown[]
      if (Array.isArray(silences) && silences.length >= expectedMin) return
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`timed out waiting for >=${expectedMin} silences`)
}

async function ensureSilencesPage(page: Page) {
  if (await page.getByRole('button', { name: 'Show expired' }).isVisible().catch(() => false)) {
    return
  }
  if (await page.getByRole('button', { name: 'Hide expired' }).isVisible().catch(() => false)) {
    return
  }
  await page.getByRole('button', { name: /Silences/ }).click()
}

async function expireSilenceInAlertmanager(silenceId: string): Promise<void> {
  const res = await fetch(`${AM_URL}/api/v2/silence/${silenceId}`, { method: 'DELETE' })
  if (!res.ok) {
    throw new Error(`failed to expire silence ${silenceId}: ${res.status} ${await res.text()}`)
  }
}

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

async function resetPersistedUIState(page: Page) {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.removeItem('jarvis-ui')
    localStorage.removeItem('jarvis-user-settings')
    localStorage.removeItem('jarvis-viewMode')
    localStorage.removeItem('jarvis-activeViewMode')
    localStorage.removeItem('jarvis-silencesViewMode')
  })
}

test('E1 silences page list view persists via localStorage', async ({ page, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await clearAllAMSilences()
  await jarvis.poll()

  const comment = 'e2e-active-silence'
  await jarvis.createSilence('e2e', [{ name: 'alertname', value: 'KubePodCrashLooping', isRegex: false, isEqual: true }], {
    comment,
    createdBy: 'e2e-tester',
  })
  await waitForSilences(JARVIS_BASE_URL, 1)

  await page.goto('/')
  await ensureSilencesPage(page)
  await expect(page.getByRole('button', { name: 'Show expired' })).toBeVisible()
  await expect(page.getByText(comment).first()).toBeVisible()

  const listToggle = page.getByTitle('List View')
  await listToggle.click()
  await expect(listToggle).toHaveAttribute('aria-pressed', 'true')

  const stored = await page.evaluate(() => localStorage.getItem('jarvis-silencesViewMode'))
  expect(stored).toBe('list')

  await page.reload()
  await ensureSilencesPage(page)
  await expect(page.getByText(comment).first()).toBeVisible()
  await expect(page.getByTitle('List View')).toHaveAttribute('aria-pressed', 'true')
})

test('E2 identical silences are grouped into one group card', async ({ page, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await clearAllAMSilences()
  await jarvis.poll()

  const now = Date.now()
  const groupComment = 'e2-grouped-card'
  const groupEndsAt = new Date(now + 60 * 60 * 1000)
  const groupStartsAt = new Date(now - 5 * 60 * 1000)
  const matchers = [{ name: 'severity', value: 'warning', isRegex: false, isEqual: true }]

  await jarvis.createSilence('e2e', matchers, {
    startsAt: groupStartsAt,
    endsAt: groupEndsAt,
    comment: groupComment,
    createdBy: 'e2e-tester',
  })
  await jarvis.createSilence('e2e', matchers, {
    startsAt: groupStartsAt,
    endsAt: groupEndsAt,
    comment: groupComment,
    createdBy: 'e2e-tester',
  })
  await waitForSilences(JARVIS_BASE_URL, 2)

  await page.goto('/')
  await ensureSilencesPage(page)

  await expect(page.getByText(groupComment)).toHaveCount(1)
  await expect(page.getByTitle('Expire 2 silences')).toHaveCount(1)
})

test('E3 show/hide expired toggles expired silences visibility', async ({ page, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await clearAllAMSilences()
  await jarvis.poll()

  const activeComment = 'e2e-active-visible'
  const expiredComment = 'e2e-expired-hidden'
  const now = Date.now()

  await jarvis.createSilence('e2e', [{ name: 'severity', value: 'warning', isRegex: false, isEqual: true }], {
    startsAt: new Date(now - 30 * 60 * 1000),
    endsAt: new Date(now + 30 * 60 * 1000),
    comment: activeComment,
    createdBy: 'e2e-tester',
  })
  const expiringSoonId = await jarvis.createSilence('e2e', [{ name: 'severity', value: 'critical', isRegex: false, isEqual: true }], {
    startsAt: new Date(now - 30 * 60 * 1000),
    endsAt: new Date(now + 10 * 60 * 1000),
    comment: expiredComment,
    createdBy: 'e2e-tester',
  })
  await expireSilenceInAlertmanager(expiringSoonId)
  await jarvis.poll()
  await waitForSilences(JARVIS_BASE_URL, 2)

  await page.goto('/')
  await ensureSilencesPage(page)

  await expect(page.getByText(activeComment).first()).toBeVisible()
  await expect(page.getByText(expiredComment)).toHaveCount(0)

  await page.getByRole('button', { name: 'Show expired' }).click()
  await expect(page.getByRole('button', { name: 'Hide expired' })).toBeVisible()
  await expect(page.getByText(expiredComment).first()).toBeVisible()
})

test('E4 sort toggle switches ordering between expires and created', async ({ page, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await clearAllAMSilences()
  await jarvis.poll()

  const now = Date.now()
  const earlyExpiryComment = 'e4-early-expiry'
  const oldCreatedComment = 'e4-old-created'

  await jarvis.createSilence('e2e', [{ name: 'alertname', value: 'E4OldCreated', isRegex: false, isEqual: true }], {
    startsAt: new Date(now - 2 * 60 * 60 * 1000),
    endsAt: new Date(now + 2 * 60 * 60 * 1000),
    comment: oldCreatedComment,
    createdBy: 'e2e-tester',
  })
  await jarvis.createSilence('e2e', [{ name: 'alertname', value: 'E4EarlyExpiry', isRegex: false, isEqual: true }], {
    startsAt: new Date(now - 30 * 60 * 1000),
    endsAt: new Date(now + 30 * 60 * 1000),
    comment: earlyExpiryComment,
    createdBy: 'e2e-tester',
  })
  await waitForSilences(JARVIS_BASE_URL, 2)

  await page.goto('/')
  await ensureSilencesPage(page)
  const e4Matchers = page.locator('span.font-mono.text-xs').filter({ hasText: 'alertname=E4' })
  await expect(e4Matchers).toHaveCount(2)
  await expect(e4Matchers.first()).toContainText('E4EarlyExpiry')

  await page.getByRole('button', { name: 'Created' }).click()
  await expect(e4Matchers.first()).toContainText('E4OldCreated')

  await page.getByRole('button', { name: 'Expires' }).click()
  await expect(e4Matchers.first()).toContainText('E4EarlyExpiry')
})

test('E5 matcher filter narrows visible silences', async ({ page, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await clearAllAMSilences()
  await jarvis.poll()

  const warningComment = 'e5-warning-silence'
  const criticalComment = 'e5-critical-silence'

  await jarvis.createSilence('e2e', [{ name: 'severity', value: 'warning', isRegex: false, isEqual: true }], {
    comment: warningComment,
    createdBy: 'e2e-tester',
  })
  await jarvis.createSilence('e2e', [{ name: 'severity', value: 'critical', isRegex: false, isEqual: true }], {
    comment: criticalComment,
    createdBy: 'e2e-tester',
  })
  await waitForSilences(JARVIS_BASE_URL, 2)

  await page.goto('/')
  await ensureSilencesPage(page)
  await expect(page.getByText(warningComment).first()).toBeVisible()
  await expect(page.getByText(criticalComment).first()).toBeVisible()

  await page.getByRole('button', { name: 'Add filter' }).click()
  const label = page.getByLabel('Label name')
  const value = page.getByLabel('Label value')
  await label.fill('severity')
  await label.press('Enter')
  await value.fill('critical')
  await value.press('Enter')

  await expect(page.getByText(criticalComment).first()).toBeVisible()
  await expect(page.getByText(warningComment)).toHaveCount(0)
})

test('E6 expiry status shows pending, active, expiring and expired labels', async ({ page, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await clearAllAMSilences()
  await jarvis.poll()

  const now = Date.now()
  const pendingComment = 'e6-pending'
  const activeComment = 'e6-active'
  const expiringComment = 'e6-expiring'
  const expiredComment = 'e6-expired'

  await jarvis.createSilence('e2e', [{ name: 'alertname', value: 'E6Pending', isRegex: false, isEqual: true }], {
    startsAt: new Date(now + 20 * 60 * 1000),
    endsAt: new Date(now + 80 * 60 * 1000),
    comment: pendingComment,
    createdBy: 'e2e-tester',
  })
  await jarvis.createSilence('e2e', [{ name: 'alertname', value: 'E6Active', isRegex: false, isEqual: true }], {
    startsAt: new Date(now - 20 * 60 * 1000),
    endsAt: new Date(now + 80 * 60 * 1000),
    comment: activeComment,
    createdBy: 'e2e-tester',
  })
  await jarvis.createSilence('e2e', [{ name: 'alertname', value: 'E6Expiring', isRegex: false, isEqual: true }], {
    startsAt: new Date(now - 20 * 60 * 1000),
    endsAt: new Date(now + 10 * 60 * 1000),
    comment: expiringComment,
    createdBy: 'e2e-tester',
  })
  const toExpireId = await jarvis.createSilence('e2e', [{ name: 'alertname', value: 'E6Expired', isRegex: false, isEqual: true }], {
    startsAt: new Date(now - 20 * 60 * 1000),
    endsAt: new Date(now + 60 * 60 * 1000),
    comment: expiredComment,
    createdBy: 'e2e-tester',
  })
  await expireSilenceInAlertmanager(toExpireId)
  await jarvis.poll()
  await waitForSilences(JARVIS_BASE_URL, 4)

  await page.goto('/')
  await ensureSilencesPage(page)
  await page.getByTitle('List View').click()
  await page.getByRole('button', { name: 'Show expired' }).click()

  const pendingRow = page.locator('div.grid').filter({ has: page.getByText(pendingComment, { exact: true }) }).first()
  const activeRow = page.locator('div.grid').filter({ has: page.getByText(activeComment, { exact: true }) }).first()
  const expiringRow = page.locator('div.grid').filter({ has: page.getByText(expiringComment, { exact: true }) }).first()
  const expiredRow = page.locator('div.grid').filter({ has: page.getByText(expiredComment, { exact: true }) }).first()

  await expect(pendingRow).toContainText('Starts in')
  await expect(activeRow).toContainText('In ')
  await expect(expiringRow).toContainText('⚠️')
  await expect(expiredRow).toContainText('Expired')
  await expect(expiredRow).toContainText('ago')
})

test('E7 expired silence can be re-created from silences page', async ({ page, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await clearAllAMSilences()
  await jarvis.poll()

  const sourceComment = 'e7-recreate-source'
  const silenceId = await jarvis.createSilence('e2e', [{ name: 'alertname', value: 'E7Recreate', isRegex: false, isEqual: true }], {
    comment: sourceComment,
    createdBy: 'e2e-tester',
  })
  await expireSilenceInAlertmanager(silenceId)
  await jarvis.poll()
  await waitForSilences(JARVIS_BASE_URL, 1)

  await page.goto('/')
  await ensureSilencesPage(page)
  await page.getByRole('button', { name: 'Show expired' }).click()
  const sourceRow = page.locator('div.grid').filter({ has: page.getByText(sourceComment, { exact: true }) }).first()
  await expect(sourceRow).toBeVisible()

  await sourceRow.getByTitle('Re-create silence').first().click()
  const formSheet = page.locator('div.fixed.inset-y-0.right-0.z-50').first()
  await expect(formSheet.getByText('Re-create Silence', { exact: true })).toBeVisible()
  await page.getByLabel('Close').click()
  await expect(formSheet).toHaveCount(0)
})

test('G1 expire single silence via modal', async ({ page, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await clearAllAMSilences()
  await jarvis.poll()

  const singleComment = 'e2e-expire-single'
  await jarvis.createSilence('e2e', [{ name: 'alertname', value: 'KubePodCrashLooping', isRegex: false, isEqual: true }], {
    comment: singleComment,
    createdBy: 'e2e-tester',
  })
  await waitForSilences(JARVIS_BASE_URL, 1)

  await page.goto('/')
  await ensureSilencesPage(page)
  await expect(page.getByText(singleComment).first()).toBeVisible()

  await page.getByTitle('Expire silence').first().click()
  await expect(page.getByRole('heading', { name: 'Expire silence?' })).toBeVisible()
  await page.getByRole('button', { name: 'Expire silence' }).last().click()

  await expect(page.getByText(singleComment)).toHaveCount(0)
  await page.getByRole('button', { name: 'Show expired' }).click()
  await expect(page.getByText(singleComment).first()).toBeVisible()
})

test('G3 expire grouped silences via modal', async ({ page, jarvis }) => {
  await dismissNoAuthNotice(page)
  await resetPersistedUIState(page)
  await clearAllAMSilences()
  await jarvis.poll()

  const now = Date.now()
  const groupComment = 'e2e-expire-group'
  const groupEndsAt = new Date(now + 60 * 60 * 1000)
  const groupStartsAt = new Date(now - 5 * 60 * 1000)
  const matchers = [{ name: 'severity', value: 'warning', isRegex: false, isEqual: true }]

  await jarvis.createSilence('e2e', matchers, {
    startsAt: groupStartsAt,
    endsAt: groupEndsAt,
    comment: groupComment,
    createdBy: 'e2e-tester',
  })
  await jarvis.createSilence('e2e', matchers, {
    startsAt: groupStartsAt,
    endsAt: groupEndsAt,
    comment: groupComment,
    createdBy: 'e2e-tester',
  })
  await waitForSilences(JARVIS_BASE_URL, 2)

  await page.goto('/')
  await ensureSilencesPage(page)
  await expect(page.getByText(groupComment).first()).toBeVisible()

  await page.getByTitle('Expire 2 silences').first().click()
  await expect(page.getByRole('heading', { name: 'Expire 2 silences?' })).toBeVisible()
  await page.getByRole('button', { name: 'Expire 2 silences' }).last().click()

  await expect(page.getByText(groupComment)).toHaveCount(0)
  await page.getByRole('button', { name: 'Show expired' }).click()
  await expect(page.getByRole('button', { name: 'Hide expired' })).toBeVisible()
  await expect(page.getByText(groupComment).first()).toBeVisible()
})
