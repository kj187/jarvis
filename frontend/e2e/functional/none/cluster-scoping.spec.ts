import { test, expect, JARVIS_BASE_URL } from '../../support/fixtures'

const fingerprint = 'f0a43ed9b3e2ac64'

const labels = {
  alertname: 'ClusterScopedAlert',
  severity: 'critical',
}

test('X1 stats and history are isolated per cluster for identical fingerprint', async ({ jarvis }) => {
  await jarvis.seedResolved([
    {
      fingerprint,
      alertname: 'ClusterScopedAlert',
      cluster: 'homelab',
      labels: { ...labels, cluster: 'homelab' },
      startsAt: '2025-01-15T10:00:00Z',
      resolvedAt: '2025-01-15T10:15:00Z',
    },
    {
      fingerprint,
      alertname: 'ClusterScopedAlert',
      cluster: 'test',
      labels: { ...labels, cluster: 'test' },
      startsAt: '2025-01-15T11:00:00Z',
      resolvedAt: '2025-01-15T11:20:00Z',
    },
  ])

  const [statsHome, statsTest, historyHome, historyTest] = await Promise.all([
    fetch(`${JARVIS_BASE_URL}/api/v1/alerts/${fingerprint}/stats?cluster=homelab`),
    fetch(`${JARVIS_BASE_URL}/api/v1/alerts/${fingerprint}/stats?cluster=test`),
    fetch(`${JARVIS_BASE_URL}/api/v1/alerts/${fingerprint}/history?cluster=homelab&limit=10&offset=0`),
    fetch(`${JARVIS_BASE_URL}/api/v1/alerts/${fingerprint}/history?cluster=test&limit=10&offset=0`),
  ])

  expect(statsHome.ok).toBeTruthy()
  expect(statsTest.ok).toBeTruthy()
  expect(historyHome.ok).toBeTruthy()
  expect(historyTest.ok).toBeTruthy()

  const homeStats = await statsHome.json()
  const testStats = await statsTest.json()
  const homeHistory = await historyHome.json()
  const testHistory = await historyTest.json()

  expect(homeStats.clusterName).toBe('homelab')
  expect(testStats.clusterName).toBe('test')
  expect(homeStats.occurrenceCount).toBe(1)
  expect(testStats.occurrenceCount).toBe(1)

  expect(homeHistory.total).toBe(2)
  expect(testHistory.total).toBe(2)
  expect(homeHistory.events.every((e: { clusterName: string }) => e.clusterName === 'homelab')).toBeTruthy()
  expect(testHistory.events.every((e: { clusterName: string }) => e.clusterName === 'test')).toBeTruthy()
})

test('X2 comments are strictly scoped by (fingerprint, cluster)', async ({ page }) => {
  const seedPayload = [
    {
      fingerprint,
      alertname: 'ClusterScopedAlert',
      cluster: 'homelab',
      labels: { ...labels, cluster: 'homelab' },
      startsAt: '2025-01-15T10:00:00Z',
      resolvedAt: '2025-01-15T10:15:00Z',
    },
    {
      fingerprint,
      alertname: 'ClusterScopedAlert',
      cluster: 'test',
      labels: { ...labels, cluster: 'test' },
      startsAt: '2025-01-15T11:00:00Z',
      resolvedAt: '2025-01-15T11:20:00Z',
    },
  ]
  const seedRes = await page.request.post(`${JARVIS_BASE_URL}/api/v1/test/seed`, {
    headers: { 'Content-Type': 'application/json' },
    data: { resolved: seedPayload },
  })
  expect(seedRes.ok()).toBeTruthy()

  const [addHome, addTest] = await Promise.all([
    page.request.post(`${JARVIS_BASE_URL}/api/v1/alerts/${fingerprint}/comments?cluster=homelab`, {
      headers: { 'Content-Type': 'application/json' },
      data: { authorName: 'alice', body: 'comment-home' },
    }),
    page.request.post(`${JARVIS_BASE_URL}/api/v1/alerts/${fingerprint}/comments?cluster=test`, {
      headers: { 'Content-Type': 'application/json' },
      data: { authorName: 'bob', body: 'comment-test' },
    }),
  ])

  expect(addHome.ok()).toBeTruthy()
  expect(addTest.ok()).toBeTruthy()

  const homeComment = await addHome.json()
  const testComment = await addTest.json()

  const [getHome, getTest] = await Promise.all([
    page.request.get(`${JARVIS_BASE_URL}/api/v1/alerts/${fingerprint}/comments?cluster=homelab`),
    page.request.get(`${JARVIS_BASE_URL}/api/v1/alerts/${fingerprint}/comments?cluster=test`),
  ])

  expect(getHome.ok()).toBeTruthy()
  expect(getTest.ok()).toBeTruthy()

  const homeComments = await getHome.json()
  const testComments = await getTest.json()

  expect(homeComments).toHaveLength(1)
  expect(testComments).toHaveLength(1)
  expect(homeComments[0].body).toBe('comment-home')
  expect(testComments[0].body).toBe('comment-test')

  const wrongClusterDelete = await page.request.delete(
    `${JARVIS_BASE_URL}/api/v1/alerts/${fingerprint}/comments/${homeComment.id}?cluster=test`,
  )
  expect(wrongClusterDelete.status()).toBe(404)

  const properDelete = await page.request.delete(
    `${JARVIS_BASE_URL}/api/v1/alerts/${fingerprint}/comments/${homeComment.id}?cluster=homelab`,
  )
  expect(properDelete.status()).toBe(204)

  const stillThere = await page.request.get(`${JARVIS_BASE_URL}/api/v1/alerts/${fingerprint}/comments?cluster=test`)
  const afterDeleteTestComments = await stillThere.json()
  expect(afterDeleteTestComments).toHaveLength(1)
  expect(afterDeleteTestComments[0].id).toBe(testComment.id)
})

test('X3 active claim lookup is isolated per cluster', async ({ jarvis, page }) => {
  const seedRes = await page.request.post(`${JARVIS_BASE_URL}/api/v1/test/seed`, {
    headers: { 'Content-Type': 'application/json' },
    data: {
      resolved: [{
        fingerprint,
        alertname: 'ClusterScopedAlert',
        cluster: 'homelab',
        labels: { ...labels, cluster: 'homelab' },
        startsAt: '2025-01-15T10:00:00Z',
        resolvedAt: '2025-01-15T10:15:00Z',
      }],
    },
  })
  expect(seedRes.ok()).toBeTruthy()

  await jarvis.setClaim(fingerprint, 'cluster-owner', 'ownership note', 'homelab')

  const [claimHome, claimTest] = await Promise.all([
    page.request.get(`${JARVIS_BASE_URL}/api/v1/alerts/${fingerprint}/claim?cluster=homelab`),
    page.request.get(`${JARVIS_BASE_URL}/api/v1/alerts/${fingerprint}/claim?cluster=test`),
  ])

  expect(claimHome.ok()).toBeTruthy()
  expect(claimTest.ok()).toBeTruthy()

  const claim = await claimHome.json()
  const missingClaim = await claimTest.json()
  expect(claim.claimedBy).toBe('cluster-owner')
  expect(claim.clusterName).toBe('homelab')
  expect(missingClaim).toBeNull()
})
