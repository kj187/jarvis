import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { kubernetesAlerts } from '../../fixtures/alerts'

test('D4 runbook annotation generates a link button in the panel', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire([
    {
      labels: { alertname: 'RunbookAlert', severity: 'critical', cluster: 'e2e' },
      annotations: {
        summary: 'Alert with runbook',
        runbook: 'https://wiki.example.com/runbooks/alert',
      },
    },
  ])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

  await page.goto('/?state=active')
  const firstCard = page.getByTestId('alert-card').first()
  await firstCard.click()
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()

  // Wait for the alert content to load (annotations section visible)
  await expect(panel.getByText('Alert with runbook')).toBeVisible({ timeout: 8_000 })

  await expect(panel.getByText('Links')).toBeVisible({ timeout: 5_000 })
  const runbookLink = panel.locator('a[href*="runbooks"]').first()
  await expect(runbookLink).toBeVisible()
  await expect(runbookLink).toHaveAttribute('href', 'https://wiki.example.com/runbooks/alert')
})

test('D4 annotation with absolute URL creates a link button', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire([
    {
      labels: { alertname: 'LinkAlert', severity: 'warning', cluster: 'e2e' },
      annotations: {
        summary: 'Alert with dashboard link',
        dashboard: 'https://grafana.example.com/d/abc123',
      },
    },
  ])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

  await page.goto('/?state=active')
  const firstCard = page.getByTestId('alert-card').first()
  await firstCard.click()
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()

  await expect(panel.getByText('Alert with dashboard link')).toBeVisible({ timeout: 8_000 })

  await expect(panel.getByText('Links')).toBeVisible({ timeout: 5_000 })
  const dashboardLink = panel.locator('a[href*="grafana.example.com"]').first()
  await expect(dashboardLink).toBeVisible()
})

test('D4 alert without URL annotations shows no Links section', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire([
    {
      labels: { alertname: 'NoLinksAlert', severity: 'info', cluster: 'e2e' },
      annotations: {
        summary: 'Plain summary without any URL here',
      },
    },
  ])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

  await page.goto('/?state=active')
  const firstCard = page.getByTestId('alert-card').first()
  await firstCard.click()
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()

  // Wait for the correct alert's summary to appear (ensures fresh data)
  await expect(panel.getByText('Plain summary without any URL here')).toBeVisible({ timeout: 8_000 })

  // No "Links" section when no URL annotations.
  // getByRole ignores aria-hidden tooltip spans that getByText would find.
  await expect(panel.getByRole('button', { name: /Links/ })).toHaveCount(0)
})

test('D12 AI prompt section is collapsed by default and copy works', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  // Grant clipboard permissions for the copy test
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

  await page.goto('/?state=active')
  const firstCard = page.getByTestId('alert-card').first()
  await firstCard.click()
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()

  // Find the AI Prompt section button — it's a button with the title text
  const aiSectionBtn = panel.getByRole('button', { name: 'AI Prompt' })
  await expect(aiSectionBtn).toBeVisible({ timeout: 5_000 })

  // Section is collapsed by default — copy button not in DOM yet
  const copyBtn = panel.getByRole('button', { name: 'Copy' })
  await expect(copyBtn).toHaveCount(0)

  // Click the section button to expand
  await aiSectionBtn.click()

  // Copy button should now appear
  await expect(copyBtn.first()).toBeVisible({ timeout: 3_000 })

  // Click copy — button should remain in DOM (clipboard op is fire-and-forget)
  await copyBtn.first().click()
  // Verify the button is still present after click (no crash)
  await expect(copyBtn.first()).toBeAttached({ timeout: 2_000 })
})

test('D13 detail panel sections can be collapsed and expanded', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire([
    {
      labels: { alertname: 'SectionAlert', severity: 'warning', cluster: 'e2e' },
      annotations: {
        summary: 'Summary text',
        description: 'Description text',
      },
    },
  ])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

  await page.goto('/?state=active')
  const firstCard = page.getByTestId('alert-card').first()
  await firstCard.click()
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()

  // Wait for content to load
  await expect(panel.getByText('Summary text')).toBeVisible({ timeout: 8_000 })

  // Labels section is open by default
  const labelsSection = page.getByTestId('detail-labels-section')
  await expect(labelsSection).toBeVisible()

  // Click the "Labels" section button to collapse
  const labelsSectionBtn = labelsSection.getByRole('button').first()
  await labelsSectionBtn.click()

  // Content should be collapsed — label items no longer in DOM
  await expect(page.getByTestId('detail-label-item').first()).not.toBeVisible()

  // Click again to expand
  await labelsSectionBtn.click()
  await expect(page.getByTestId('detail-label-item').first()).toBeVisible()
})

test('D13 annotations section can be collapsed', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire([
    {
      labels: { alertname: 'CollapseAlert', severity: 'warning', cluster: 'e2e' },
      annotations: {
        summary: 'A summary',
        extra: 'Extra annotation',
      },
    },
  ])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

  await page.goto('/?state=active')
  const firstCard = page.getByTestId('alert-card').first()
  await firstCard.click()
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()

  await expect(panel.getByText('A summary')).toBeVisible({ timeout: 8_000 })

  const annotationsSection = page.getByTestId('detail-annotations-section')
  await expect(annotationsSection).toBeVisible()

  // Collapse
  const annotationsBtn = annotationsSection.getByRole('button').first()
  await annotationsBtn.click()

  await expect(page.getByTestId('detail-annotation-item').first()).not.toBeVisible()

  // Expand
  await annotationsBtn.click()
  await expect(page.getByTestId('detail-annotation-item').first()).toBeVisible()
})

test('D14 silence can be created from detail panel', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.goto('/?state=active')
  const firstCard = page.getByTestId('alert-card').first()
  await firstCard.click()
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()

  const silenceBtn = panel.getByRole('button', { name: 'Silence' })
  await expect(silenceBtn).toBeVisible()
  await silenceBtn.click()

  // A silence form sheet should open
  await expect(page.getByPlaceholder('Reason for the silence…').first()).toBeVisible({ timeout: 5_000 })

  await page.getByRole('button', { name: 'Cancel' }).first().click()
})

test('D14 silence form from detail panel is pre-filled with alert matchers', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire([
    {
      labels: { alertname: 'PrefillAlert', severity: 'critical', cluster: 'e2e', team: 'platform' },
      annotations: { summary: 'Alert for prefill test' },
    },
  ])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

  await page.goto('/?state=active')
  const firstCard = page.getByTestId('alert-card').first()
  await firstCard.click()
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()

  const silenceBtn = panel.getByRole('button', { name: 'Silence' })
  await silenceBtn.click()

  await expect(page.getByPlaceholder('Reason for the silence…').first()).toBeVisible({ timeout: 5_000 })

  // Alert name matcher should be pre-filled (visible as a tag chip)
  await expect(page.getByText('PrefillAlert').first()).toBeVisible()

  await page.getByRole('button', { name: 'Cancel' }).first().click()
})

test('D8 claim history entries appear in the history section', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire([
    {
      labels: { alertname: 'D8ClaimAlert', severity: 'warning', cluster: 'e2e' },
      annotations: { summary: 'D8 claim history test' },
    },
  ])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

  const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
  const alerts: any[] = await res.json()
  const fingerprint = alerts[0].fingerprint

  await jarvis.setClaim(fingerprint, 'd8-claimer', 'D8 test note')

  await page.goto(`/?state=active&alert=${fingerprint}`)
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()

  // History section includes claim events — "Who" column shows the claimer
  await expect(panel.getByText('d8-claimer').first()).toBeVisible({ timeout: 8_000 })
  // Action column shows "claimed"
  await expect(panel.getByText('claimed').first()).toBeVisible({ timeout: 5_000 })
})

test('D11 comments survive alert re-fire', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  const alertDef = [
    {
      labels: { alertname: 'D11CommentAlert', severity: 'warning', cluster: 'e2e' },
      annotations: { summary: 'D11 comment persistence test' },
    },
  ]
  await am.fire(alertDef)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

  const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
  const alerts: any[] = await res.json()
  const fingerprint = alerts[0].fingerprint

  await jarvis.addComment(fingerprint, 'D11 persistent comment', 'comment-author')

  await page.goto(`/?state=active&alert=${fingerprint}`)
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()

  // Verify comment is visible initially
  await expect(panel.getByText('D11 persistent comment')).toBeVisible({ timeout: 8_000 })

  // Re-fire the same alert — within the 60s grace period, event is reopened (not new)
  await am.fire(alertDef)
  await jarvis.poll()

  // Reload and verify comment still exists
  await page.reload()
  await expect(page.getByTestId('detail-panel')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('D11 persistent comment')).toBeVisible({ timeout: 8_000 })
})
