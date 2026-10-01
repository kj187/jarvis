import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'

const commented = {
  labels: { alertname: 'CommentCountAlert', severity: 'warning', cluster: 'e2e' },
  annotations: { summary: 'has comments', description: 'has comments' },
}
const quiet = {
  labels: { alertname: 'QuietAlert', severity: 'warning', cluster: 'e2e' },
  annotations: { summary: 'has no comments', description: 'has no comments' },
}

async function fingerprintOf(alertname: string): Promise<{ fingerprint: string; clusterName: string }> {
  const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
  const alerts: any[] = await res.json()
  const alert = alerts.find((a) => a.labels.alertname === alertname)
  return { fingerprint: alert.fingerprint, clusterName: alert.clusterName }
}

test('comment count shows on the card and the list row, only for commented alerts', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire([commented, quiet])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 2)
  const { fingerprint, clusterName } = await fingerprintOf('CommentCountAlert')
  await jarvis.addComment(fingerprint, 'first', 'tester', clusterName)
  await jarvis.addComment(fingerprint, 'second', 'tester', clusterName)

  await page.goto('/?state=active')
  const card = page.getByTestId('alert-card').filter({ hasText: /^has comments|has comments$/ })
  await expect(card.getByTestId('comment-count')).toHaveText('2')
  await expect(card.getByTestId('comment-count')).toHaveAttribute('title', '2 comments')
  await expect(page.getByTestId('alert-card').filter({ hasText: 'has no comments' }).getByTestId('comment-count')).toHaveCount(0)

  // List view: collapsed groups carry the sum, the expanded row carries its own count.
  await page.getByTitle('List View').click()
  const group = page.getByTestId('alert-group-row').filter({ hasText: 'CommentCountAlert' })
  await expect(group.getByTestId('comment-count')).toHaveText('2')
  await expect(group.getByTestId('comment-count')).toHaveAttribute('title', '2 comments in this group')
  await expect(page.getByTestId('alert-group-row').filter({ hasText: 'QuietAlert' }).getByTestId('comment-count')).toHaveCount(0)

  await group.click()
  const row = page.getByTestId('alert-list-row').filter({ hasText: 'has comments' })
  await expect(row.getByTestId('comment-count')).toHaveText('2')
})

test('comment count updates live when a comment is added in the detail panel', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire([commented])
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)
  const { fingerprint } = await fingerprintOf('CommentCountAlert')

  await page.goto('/?state=active')
  const card = page.getByTestId('alert-card').filter({ hasText: /^has comments|has comments$/ })
  await expect(card).toBeVisible()
  await expect(card.getByTestId('comment-count')).toHaveCount(0)

  await page.goto(`/?state=active&alert=${fingerprint}`)
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()
  await panel.getByTestId('detail-tab-comments').click()
  await panel.getByPlaceholder('Your name').fill('tester')
  await panel.getByTestId('detail-comment-input').fill('live count')
  await panel.getByTestId('detail-comment-submit').click()
  await expect(panel.getByText('live count')).toBeVisible({ timeout: 8_000 })

  await page.getByTestId('detail-panel-close').click()
  await expect(page.getByTestId('alert-card').filter({ hasText: /^has comments|has comments$/ }).getByTestId('comment-count')).toHaveText('1')
})
