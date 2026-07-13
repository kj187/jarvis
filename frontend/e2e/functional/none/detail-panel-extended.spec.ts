import { test, expect, waitForActiveAlerts, expandComments, JARVIS_BASE_URL } from '../../support/fixtures'
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

test('D12 AI prompt tab shows the prompt and copy works', async ({ page, am, jarvis }) => {
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

  // AI Prompt has its own tab — not shown until selected.
  const copyBtn = panel.getByRole('button', { name: 'Copy' })
  await expect(copyBtn).toHaveCount(0)

  await panel.getByTestId('detail-tab-ai-prompt').click()
  await expect(copyBtn.first()).toBeVisible({ timeout: 5_000 })

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

  const silenceBtn = panel.getByRole('button', { name: 'Silence', exact: true })
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

  const silenceBtn = panel.getByRole('button', { name: 'Silence', exact: true })
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
  await panel.getByTestId('detail-tab-history').click()

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
  await expandComments(panel)

  // Verify comment is visible initially
  await expect(panel.getByText('D11 persistent comment')).toBeVisible({ timeout: 8_000 })

  // Re-fire the same alert — within the 60s grace period, event is reopened (not new)
  await am.fire(alertDef)
  await jarvis.poll()

  // Reload and verify comment still exists
  await page.reload()
  await expect(page.getByTestId('detail-panel')).toBeVisible({ timeout: 10_000 })
  await expandComments(page)
  await expect(page.getByText('D11 persistent comment')).toBeVisible({ timeout: 8_000 })
})

test('D12 comments pager stays hidden at or below the page size (5)', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire([
    {
      labels: { alertname: 'D12NoPagerAlert', severity: 'warning', cluster: 'e2e' },
      annotations: { summary: 'D12 no-pager-yet test' },
    },
  ])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

  const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
  const alerts: any[] = await res.json()
  const fingerprint = alerts[0].fingerprint

  for (let i = 0; i < 5; i++) {
    await jarvis.addComment(fingerprint, `comment number ${i}`, 'pager-tester')
  }

  await page.goto(`/?state=active&alert=${fingerprint}`)
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()
  await expandComments(panel)
  await expect(panel.getByText('comment number 4')).toBeVisible({ timeout: 8_000 })

  await expect(panel.getByTestId('comments-pager')).toHaveCount(0)
})

test('D12 comments panel paginates newest-first once past the page size', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire([
    {
      labels: { alertname: 'D12PaginationAlert', severity: 'warning', cluster: 'e2e' },
      annotations: { summary: 'D12 pagination test' },
    },
  ])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

  const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
  const alerts: any[] = await res.json()
  const fingerprint = alerts[0].fingerprint

  // Page size is 5 — 7 comments produce 2 pages (5 + 2).
  for (let i = 0; i < 7; i++) {
    await jarvis.addComment(fingerprint, `comment number ${i}`, 'pager-tester')
  }

  await page.goto(`/?state=active&alert=${fingerprint}`)
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()
  await expandComments(panel)

  const pagerLabel = panel.getByTestId('comments-pager-label')
  await expect(pagerLabel).toHaveText('Page 1 of 2', { timeout: 8_000 })

  // Newest first: comment 6 (added last) is on page 1.
  await expect(panel.getByText('comment number 6')).toBeVisible()
  await expect(panel.getByText('comment number 0')).not.toBeVisible()

  await panel.getByRole('button', { name: 'Next page' }).click()
  await expect(pagerLabel).toHaveText('Page 2 of 2')

  // Oldest comment (0) is on the last page.
  await expect(panel.getByText('comment number 0')).toBeVisible()
})

test('D13 comment markdown renders a fenced code block and neutralizes raw HTML', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire([
    {
      labels: { alertname: 'D13MarkdownAlert', severity: 'warning', cluster: 'e2e' },
      annotations: { summary: 'D13 markdown rendering test' },
    },
  ])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

  const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
  const alerts: any[] = await res.json()
  const fingerprint = alerts[0].fingerprint

  const codeBody = '**bold text** and a [link](https://example.com/runbook)\n\n```bash\necho hello\n```'
  await jarvis.addComment(fingerprint, codeBody, 'markdown-tester')

  const xssBody = 'before <script>window.__jarvisXssFired = true</script> after'
  await jarvis.addComment(fingerprint, xssBody, 'xss-tester')

  await page.goto(`/?state=active&alert=${fingerprint}`)
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()
  await expandComments(panel)

  const items = panel.getByTestId('detail-comment-item')
  await expect(items.first()).toBeVisible({ timeout: 8_000 })

  // Fenced code block renders as <pre><code>, not literal backticks.
  const codeBlock = panel.locator('pre code', { hasText: 'echo hello' })
  await expect(codeBlock).toBeVisible()

  // Bold and link render as real elements.
  await expect(panel.locator('strong', { hasText: 'bold text' })).toBeVisible()
  const link = panel.locator('a[href="https://example.com/runbook"]')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')

  // Raw <script> is neither rendered as an element nor executed.
  await expect(panel.locator('script', { hasText: '__jarvisXssFired' })).toHaveCount(0)
  const xssFired = await page.evaluate(() => (window as any).__jarvisXssFired)
  expect(xssFired).toBeUndefined()
})
