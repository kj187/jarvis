import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { fireWithHeatmapHistory, pickAlertWithHistory } from '../../support/heatmapHistory'
import { kubernetesAlerts } from '../../fixtures/alerts'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Screenshots: one per detail-panel tab (Details / History / Comments /
 * Related / AI Prompt), cropped to the panel element — docs images for the
 * per-tab bullet points in docs/features.md, complementing the full-page
 * feature-detail-panel.png. One test writes all five PNGs (a single
 * fire+seed setup serves every tab).
 * Uses fireWithHeatmapHistory (freezes the clock itself) so History has a
 * populated timeline; pickAlertWithHistory so the chosen alert actually got
 * backfilled events. Comments are seeded via the test API so the Comments
 * tab isn't an empty state.
 * Regenerate: make e2e-screenshot NAME=detail-tabs
 */
test('detail-tabs', async ({ page, am, jarvis }) => {
  await page.setViewportSize({ width: 1280, height: 1050 })
  await dismissNoAuthNotice(page)
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, kubernetesAlerts)

  const res = await page.request.get(`${JARVIS_BASE_URL}/api/v1/alerts`)
  const alerts: any[] = await res.json()
  const picked = await pickAlertWithHistory(JARVIS_BASE_URL, alerts)
  const alert = alerts.find((a) => a.fingerprint === picked.fingerprint) ?? alerts[0]

  await jarvis.addComment(
    alert.fingerprint,
    'Restarted the pod — OOMKilled again within minutes. Memory limit looks too low for the current batch size.',
    'jane-doe',
    alert.clusterName,
  )
  await jarvis.addComment(
    alert.fingerprint,
    'Raised the limit to `512Mi` in [platform-config#142](https://git.example.com/platform-config/pull/142), watching.',
    'sam-oncall',
    alert.clusterName,
  )

  await page.goto(`/?state=active&alert=${alert.fingerprint}`)
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()
  await page.waitForTimeout(300)

  const tabs = [
    { key: 'details', waitFor: 'detail-labels-section' },
    { key: 'history', waitFor: null },
    { key: 'comments', waitFor: 'detail-comments-section' },
    { key: 'related', waitFor: 'detail-related-section' },
    { key: 'ai-prompt', waitFor: null },
  ] as const

  for (const tab of tabs) {
    await page.getByTestId(`detail-tab-${tab.key}`).click()
    if (tab.waitFor) await expect(page.getByTestId(tab.waitFor)).toBeVisible()
    await page.waitForTimeout(300)

    // Crop to the panel, but cut vertical dead space below short tab content
    // (the sheet itself always spans the full viewport height): clip from the
    // panel's top edge to the bottom of the scroll container's last child.
    const panelBox = (await panel.boundingBox())!
    const contentBottom = await panel.evaluate((el) => {
      const kids = el.querySelector('.sheet-scroll')?.children ?? []
      const last = kids[kids.length - 1]
      return last ? last.getBoundingClientRect().bottom : 0
    })
    const height = Math.min(panelBox.height, Math.max(400, contentBottom + 16 - panelBox.y))
    await page.screenshot({
      path: `${DIR}/feature-detail-tab-${tab.key}.png`,
      clip: { x: panelBox.x, y: panelBox.y, width: panelBox.width, height },
    })
  }
})
