import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { kubernetesAlerts } from '../../fixtures/alerts'

test('J2 alerts_update WS event updates the UI without page reload', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await page.goto('/?state=active')

  // Wait for WS to connect
  await expect(page.locator('[title="WebSocket connected"]').first()).toBeVisible({ timeout: 10_000 })

  // No alerts yet — empty state
  await expect(page.locator('[aria-label="No alerts"]')).toBeVisible({ timeout: 5_000 })

  // Fire alerts — poll will deliver them via WS update
  await am.fire(kubernetesAlerts)
  await jarvis.poll()

  // Cards should appear without page reload
  const firstCard = page.getByTestId('alert-card').first()
  await expect(firstCard).toBeVisible({ timeout: 10_000 })
})

test('J3 claim_set WS event shows claim badge in open detail panel', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  // Get first fingerprint
  const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
  const alerts: any[] = await res.json()
  const fingerprint = alerts[0].fingerprint

  // Open the detail panel
  await page.goto(`/?state=active&alert=${fingerprint}`)
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()

  // Wait for WS connection before triggering claim — otherwise event arrives before socket is ready
  await expect(page.locator('[title="WebSocket connected"]').first()).toBeVisible({ timeout: 10_000 })

  // Set claim via API — WS should push update to open panel
  await jarvis.setClaim(fingerprint, 'ws-claimer', 'WS test note')

  // Claim badge should appear without reload
  const claimBadge = page.getByTestId('detail-claim-badge')
  await expect(claimBadge).toBeVisible({ timeout: 10_000 })
  await expect(claimBadge).toContainText('ws-claimer')
})

test('J3 claim_released WS event removes claim badge from detail panel', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
  const alerts: any[] = await res.json()
  const fingerprint = alerts[0].fingerprint

  // Pre-seed a claim
  await jarvis.setClaim(fingerprint, 'ws-claimer')

  // Open the detail panel with the claim visible
  await page.goto(`/?state=active&alert=${fingerprint}`)
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()
  await expect(page.getByTestId('detail-claim-badge')).toBeVisible({ timeout: 8_000 })

  // Release claim via the panel button (which triggers WS update)
  await page.addInitScript(() => localStorage.setItem('jarvis-username', 'ws-claimer'))
  await page.reload()
  await expect(page.getByTestId('detail-panel')).toBeVisible()
  await expect(page.getByTestId('detail-claim-badge')).toBeVisible({ timeout: 5_000 })

  // Click release button
  const releaseBtn = page.getByTestId('claim-release-button')
  await expect(releaseBtn).toBeVisible()
  await releaseBtn.click()

  // Badge should disappear via WS update
  await expect(page.getByTestId('detail-claim-badge')).not.toBeVisible({ timeout: 5_000 })
})

test('J1 WebSocket reconnect indicator turns red when blocked and green after reconnect', async ({ page }) => {
  await dismissNoAuthNotice(page)

  // Patch WebSocket before page load to track live instances so we can force-close
  await page.addInitScript(() => {
    const OrigWS = window.WebSocket
    const live: WebSocket[] = []
    ;(window as any).__closeAllWS = () => live.forEach((ws) => ws.close())
    class PatchedWS extends OrigWS {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        live.push(this)
        this.addEventListener('close', () => live.splice(live.indexOf(this), 1))
      }
    }
    window.WebSocket = PatchedWS as typeof WebSocket
  })

  await page.goto('/?state=active')

  // Wait for initial WS connection
  await expect(page.locator('[title="WebSocket connected"]').first()).toBeVisible({ timeout: 10_000 })

  // Force-close the WS from inside the page — triggers onclose → wsConnected=false
  await page.evaluate(() => (window as any).__closeAllWS())
  await expect(page.locator('[title="WebSocket disconnected"]').first()).toBeVisible({ timeout: 10_000 })

  // App retries after RECONNECT_DELAY (3s) — indicator turns green
  await expect(page.locator('[title="WebSocket connected"]').first()).toBeVisible({ timeout: 30_000 })
})

test('J4 comment_added WS event updates comments section without reload', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
  const alerts: any[] = await res.json()
  const fingerprint = alerts[0].fingerprint
  const clusterName = alerts[0].clusterName

  // Open the detail panel
  await page.goto(`/?state=active&alert=${fingerprint}`)
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()

  // Wait for WS to be connected before posting comment
  await expect(page.locator('[title="WebSocket connected"]').first()).toBeVisible({ timeout: 10_000 })

  // Use the production endpoint — only it broadcasts the comment_added WS event
  // The test endpoint /api/v1/test/comment writes to DB but does NOT broadcast WS
  await page.request.post(
    `${JARVIS_BASE_URL}/api/v1/alerts/${fingerprint}/comments?cluster=${encodeURIComponent(clusterName)}`,
    {
      headers: { 'Content-Type': 'application/json' },
      data: { authorName: 'ws-author', body: 'WS comment test' },
    },
  )

  // Comment should appear in the panel without page reload (pushed via WS)
  const commentItems = page.getByTestId('detail-comment-item')
  await expect(commentItems.first()).toBeVisible({ timeout: 10_000 })
  const commentTexts = await commentItems.allTextContents()
  expect(commentTexts.join('\n')).toContain('WS comment test')
})
