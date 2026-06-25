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

test('E1 silences page list view persists via localStorage', async ({ page, jarvis }) => {
  await dismissNoAuthNotice(page)
  await clearAllAMSilences()
  await jarvis.poll()

  await jarvis.createSilence('e2e', [{ name: 'alertname', value: 'KubePodCrashLooping', isRegex: false, isEqual: true }], {
    comment: 'e2e-active-silence',
    createdBy: 'e2e-tester',
  })
  await waitForSilences(JARVIS_BASE_URL, 1)

  await page.goto('/')
  await ensureSilencesPage(page)
  await expect(page.getByRole('button', { name: 'Show expired' })).toBeVisible()

  await page.getByTitle('List View').click()
  await expect(page.getByText('Matchers / Clusters / Comment')).toBeVisible()

  const stored = await page.evaluate(() => localStorage.getItem('jarvis-silencesViewMode'))
  expect(stored).toBe('list')

  await page.reload()
  await ensureSilencesPage(page)
  await expect(page.getByText('Matchers / Clusters / Comment')).toBeVisible()
})

test('E3 show/hide expired toggles expired silences visibility', async ({ page, jarvis }) => {
  await dismissNoAuthNotice(page)
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

test('G1 expire single silence via modal', async ({ page, jarvis }) => {
  await dismissNoAuthNotice(page)
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
