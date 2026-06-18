/**
 * Feature Screenshots
 *
 * Generates all docs/assets/feature-*.png and docs/assets/screenshot.png
 * using mocked API responses — no live backend required.
 *
 * Run:
 *   SCREENSHOTS_DIR=../docs/assets pnpm exec playwright test e2e/feature-screenshots.spec.ts --reporter=line
 *
 * Or via Makefile:
 *   make screenshots
 */

import { test, type Page } from '@playwright/test'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ASSETS_DIR =
  process.env.SCREENSHOTS_DIR ?? path.resolve(__dirname, '../../docs/assets')

// ── Time helpers ──────────────────────────────────────────────────────────────

const now = Date.now()
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString()
const fromNow = (minutes: number) => new Date(now + minutes * 60_000).toISOString()

// ── Mock data ─────────────────────────────────────────────────────────────────

const SILENCE_ACTIVE = {
  id: 'sil-001',
  matchers: [
    { isEqual: true, isRegex: false, name: 'alertname', value: 'HighMemoryUsage' },
    { isEqual: true, isRegex: false, name: 'namespace', value: 'production' },
  ],
  startsAt: ago(120),
  endsAt: fromNow(120),
  createdBy: 'alice',
  comment: 'Known issue — memory leak fix in progress, ticket INFRA-4821',
  status: { state: 'active' },
  updatedAt: ago(120),
  clusterName: 'homelab',
  alertmanagerUrl: 'http://alertmanager:9093',
}

const SILENCE_EXPIRING = {
  id: 'sil-002',
  matchers: [
    { isEqual: true, isRegex: false, name: 'alertname', value: 'DiskSpaceWarning' },
    { isEqual: true, isRegex: false, name: 'instance', value: 'node-03' },
  ],
  startsAt: ago(225),
  endsAt: fromNow(8),   // expires in 8 min → triggers expiring-soon reclassification
  createdBy: 'bob',
  comment: 'Cleaning up old logs — expect resolution within 30 min',
  status: { state: 'active' },
  updatedAt: ago(225),
  clusterName: 'homelab',
  alertmanagerUrl: 'http://alertmanager:9093',
}

const ALERTS_ACTIVE = [
  {
    fingerprint: 'fp-001',
    status: { inhibitedBy: [], silencedBy: [], state: 'active' },
    labels: { alertname: 'PodCrashLooping', severity: 'critical', namespace: 'production', pod: 'api-7d8f9c-xkj2p', container: 'api' },
    annotations: { summary: 'Pod is crash looping', description: 'Pod api-7d8f9c-xkj2p in namespace production has been restarting repeatedly.', runbook: 'https://wiki.example.com/runbooks/pod-crash-loop', dashboard: 'https://grafana.example.com/d/k8s-pods' },
    startsAt: ago(42),
    endsAt: fromNow(600),
    updatedAt: ago(2),
    generatorURL: 'http://prometheus:9090',
    receivers: [{ name: 'pagerduty' }],
    clusterName: 'homelab',
    alertmanagerUrl: 'http://alertmanager:9093',
    activeClaim: undefined,
  },
  // ── TargetDown group (18 alerts — same alertname+severity → renders as one grouped card) ──
  ...([
    { fp: 'fp-005a', instance: 'node-exporter:9100',  node: 'node-01', ago: 7,   claim: undefined },
    { fp: 'fp-005b', instance: 'node-exporter:9100',  node: 'node-02', ago: 9,   claim: { id: 2, fingerprint: 'fp-005b', claimedBy: 'bob', claimedAt: ago(12), note: 'Investigating network partition on node-02' } },
    { fp: 'fp-005c', instance: 'kube-state-metrics:8080', node: 'node-03', ago: 11, claim: undefined },
    { fp: 'fp-005d', instance: 'cadvisor:8080',        node: 'node-04', ago: 14, claim: undefined },
    { fp: 'fp-005e', instance: 'kube-proxy:10249',     node: 'node-05', ago: 5,  claim: undefined },
    { fp: 'fp-005f', instance: 'kubelet:10255',        node: 'node-06', ago: 3,  claim: undefined },
    { fp: 'fp-005g', instance: 'node-exporter:9100',  node: 'node-07', ago: 8,  claim: undefined },
    { fp: 'fp-005h', instance: 'node-exporter:9100',  node: 'node-08', ago: 6,  claim: undefined },
    { fp: 'fp-005i', instance: 'node-exporter:9100',  node: 'node-09', ago: 4,  claim: undefined },
    { fp: 'fp-005j', instance: 'kubelet:10255',        node: 'node-10', ago: 10, claim: undefined },
    { fp: 'fp-005k', instance: 'kube-proxy:10249',     node: 'node-11', ago: 13, claim: undefined },
    { fp: 'fp-005l', instance: 'cadvisor:8080',        node: 'node-12', ago: 16, claim: undefined },
    { fp: 'fp-005m', instance: 'node-exporter:9100',  node: 'node-13', ago: 2,  claim: undefined },
    { fp: 'fp-005n', instance: 'node-exporter:9100',  node: 'node-14', ago: 19, claim: undefined },
    { fp: 'fp-005o', instance: 'node-exporter:9100',  node: 'node-15', ago: 22, claim: undefined },
    { fp: 'fp-005p', instance: 'kubelet:10255',        node: 'node-16', ago: 25, claim: undefined },
    { fp: 'fp-005q', instance: 'kube-state-metrics:8080', node: 'node-17', ago: 28, claim: undefined },
    { fp: 'fp-005r', instance: 'node-exporter:9100',  node: 'node-18', ago: 30, claim: undefined },
  ] as const).map(({ fp, instance, node, ago: a, claim }) => ({
    fingerprint: fp,
    status: { inhibitedBy: [], silencedBy: [], state: 'active' as const },
    labels: { alertname: 'TargetDown', severity: 'critical', instance, node, job: 'node-exporter', env: 'prod' },
    annotations: { summary: 'Scrape target is unreachable', description: `Prometheus target ${instance} on ${node} has been unreachable for more than 1 minute.` },
    startsAt: ago(a),
    endsAt: fromNow(600),
    updatedAt: ago(1),
    generatorURL: 'http://prometheus:9090',
    receivers: [{ name: 'pagerduty' }],
    clusterName: 'homelab',
    alertmanagerUrl: 'http://alertmanager:9093',
    activeClaim: claim,
  })),
  {
    fingerprint: 'fp-006',
    status: { inhibitedBy: [], silencedBy: [], state: 'active' },
    labels: { alertname: 'KubeAPIServerDown', severity: 'critical', cluster: 'production', job: 'apiserver' },
    annotations: { summary: 'Kubernetes API server unreachable', description: 'The Kubernetes API server has been unreachable for more than 2 minutes.' },
    startsAt: ago(3),
    endsAt: fromNow(600),
    updatedAt: ago(1),
    generatorURL: 'http://prometheus:9090',
    receivers: [{ name: 'pagerduty' }],
    clusterName: 'homelab',
    alertmanagerUrl: 'http://alertmanager:9093',
    activeClaim: undefined,
  },
  {
    fingerprint: 'fp-002',
    status: { inhibitedBy: [], silencedBy: [], state: 'active' },
    labels: { alertname: 'HighCPUUsage', severity: 'warning', namespace: 'production', instance: 'node-01', job: 'node-exporter' },
    annotations: { summary: 'CPU usage above 90%', description: 'Instance node-01 has been running above 90% CPU for more than 10 minutes.' },
    startsAt: ago(18),
    endsAt: fromNow(600),
    updatedAt: ago(1),
    generatorURL: 'http://prometheus:9090',
    receivers: [{ name: 'slack' }],
    clusterName: 'homelab',
    alertmanagerUrl: 'http://alertmanager:9093',
    activeClaim: undefined,
  },
  {
    fingerprint: 'fp-003',
    status: { inhibitedBy: [], silencedBy: ['sil-002'], state: 'active' },
    labels: { alertname: 'DiskSpaceWarning', severity: 'warning', instance: 'node-03', mountpoint: '/var/lib/docker', job: 'node-exporter' },
    annotations: { summary: 'Disk usage above 85%', description: 'Disk at /var/lib/docker on node-03 is 87% full.' },
    startsAt: ago(230),
    endsAt: fromNow(8),   // silence expires soon → expiring-soon state
    updatedAt: ago(1),
    generatorURL: 'http://prometheus:9090',
    receivers: [{ name: 'slack' }],
    clusterName: 'homelab',
    alertmanagerUrl: 'http://alertmanager:9093',
    activeClaim: undefined,
  },
  {
    fingerprint: 'fp-007',
    status: { inhibitedBy: [], silencedBy: [], state: 'active' },
    labels: { alertname: 'PersistentVolumeFillingUp', severity: 'warning', namespace: 'monitoring', persistentvolumeclaim: 'prometheus-db', job: 'kubelet' },
    annotations: { summary: 'PersistentVolume is filling up', description: 'PVC prometheus-db in namespace monitoring is 92% full and will fill up within 6 hours.' },
    startsAt: ago(55),
    endsAt: fromNow(600),
    updatedAt: ago(3),
    generatorURL: 'http://prometheus:9090',
    receivers: [{ name: 'slack' }],
    clusterName: 'homelab',
    alertmanagerUrl: 'http://alertmanager:9093',
    activeClaim: undefined,
  },
  {
    fingerprint: 'fp-008',
    status: { inhibitedBy: [], silencedBy: [], state: 'active' },
    labels: { alertname: 'SlowDatabaseQueries', severity: 'info', namespace: 'production', service: 'postgres', job: 'postgres-exporter' },
    annotations: { summary: 'Slow database queries detected', description: 'Average query latency on postgres in namespace production exceeds 500ms.' },
    startsAt: ago(90),
    endsAt: fromNow(600),
    updatedAt: ago(10),
    generatorURL: 'http://prometheus:9090',
    receivers: [{ name: 'slack' }],
    clusterName: 'homelab',
    alertmanagerUrl: 'http://alertmanager:9093',
    activeClaim: undefined,
  },
  {
    fingerprint: 'fp-004',
    status: { inhibitedBy: [], silencedBy: ['sil-001'], state: 'suppressed' },
    labels: { alertname: 'HighMemoryUsage', severity: 'warning', namespace: 'production', instance: 'node-02', job: 'node-exporter' },
    annotations: { summary: 'Memory usage above 85%', description: 'Instance node-02 memory usage is 88%.' },
    startsAt: ago(125),
    endsAt: fromNow(120),
    updatedAt: ago(5),
    generatorURL: 'http://prometheus:9090',
    receivers: [{ name: 'slack' }],
    clusterName: 'homelab',
    alertmanagerUrl: 'http://alertmanager:9093',
    activeClaim: undefined,
  },
]

const ALERTS_ACTIVE_WITH_CLAIM = ALERTS_ACTIVE.map((a) =>
  a.fingerprint === 'fp-001'
    ? {
        ...a,
        activeClaim: {
          id: 1,
          fingerprint: 'fp-001',
          claimedBy: 'alice',
          claimedAt: ago(15),
          note: 'Checking pod logs and recent deploys',
        },
      }
    : a,
)

const ALERTS_RESOLVED = [
  {
    fingerprint: 'fp-r01',
    status: { inhibitedBy: [], silencedBy: [], state: 'resolved' },
    labels: { alertname: 'HighErrorRate', severity: 'critical', namespace: 'staging', service: 'checkout' },
    annotations: { summary: 'Error rate above 5%', description: 'Checkout service error rate reached 12% for 5 minutes.' },
    startsAt: ago(200),
    endsAt: ago(160),
    updatedAt: ago(160),
    generatorURL: 'http://prometheus:9090',
    receivers: [{ name: 'pagerduty' }],
    clusterName: 'homelab',
    alertmanagerUrl: 'http://alertmanager:9093',
    activeClaim: undefined,
  },
  {
    fingerprint: 'fp-r02',
    status: { inhibitedBy: [], silencedBy: [], state: 'resolved' },
    labels: { alertname: 'PodCrashLooping', severity: 'critical', namespace: 'staging', pod: 'worker-abc123', container: 'worker' },
    annotations: { summary: 'Pod is crash looping', description: 'Pod worker-abc123 restarted 8 times in 15 minutes.' },
    startsAt: ago(310),
    endsAt: ago(280),
    updatedAt: ago(280),
    generatorURL: 'http://prometheus:9090',
    receivers: [{ name: 'slack' }],
    clusterName: 'homelab',
    alertmanagerUrl: 'http://alertmanager:9093',
    activeClaim: undefined,
  },
  {
    fingerprint: 'fp-r03',
    status: { inhibitedBy: [], silencedBy: [], state: 'resolved' },
    labels: { alertname: 'HighMemoryUsage', severity: 'warning', namespace: 'production', instance: 'node-01', job: 'node-exporter' },
    annotations: { summary: 'Memory usage above 85%', description: 'node-01 memory recovered after OOM killer freed cache.' },
    startsAt: ago(480),
    endsAt: ago(430),
    updatedAt: ago(430),
    generatorURL: 'http://prometheus:9090',
    receivers: [{ name: 'slack' }],
    clusterName: 'homelab',
    alertmanagerUrl: 'http://alertmanager:9093',
    activeClaim: undefined,
  },
]

const MOCK_CLUSTERS = [
  { name: 'homelab', alertmanagerUrl: 'http://alertmanager:9093', prometheusUrl: 'http://prometheus:9090', healthy: true, alertCount: 25 },
]

const MOCK_STATS = {
  fingerprint: 'fp-001',
  alertname: 'PodCrashLooping',
  clusterName: 'homelab',
  firstSeenAt: ago(180),
  lastSeenAt: ago(2),
  lastResolvedAt: ago(60),
  occurrenceCount: 5,
}

const MOCK_HISTORY = {
  events: [
    { id: 1, fingerprint: 'fp-001', clusterName: 'homelab', alertmanagerUrl: '', status: 'firing', startsAt: ago(42), endsAt: null, annotations: '{}', recordedAt: ago(42) },
    { id: 2, fingerprint: 'fp-001', clusterName: 'homelab', alertmanagerUrl: '', status: 'resolved', startsAt: ago(120), endsAt: ago(60), annotations: '{}', recordedAt: ago(60) },
    { id: 3, fingerprint: 'fp-001', clusterName: 'homelab', alertmanagerUrl: '', status: 'firing', startsAt: ago(180), endsAt: ago(120), annotations: '{}', recordedAt: ago(180) },
  ],
  total: 3,
}

const MOCK_COMMENTS = [
  { id: 1, fingerprint: 'fp-001', authorName: 'alice', body: 'Checked recent deploys — last deploy was 2 hours ago, matches alert start time.', createdAt: ago(35) },
  { id: 2, fingerprint: 'fp-001', authorName: 'bob', body: 'Rolling back the deploy now.', createdAt: ago(20) },
]

const MOCK_CLAIM = {
  id: 1,
  fingerprint: 'fp-001',
  claimedBy: 'alice',
  claimedAt: ago(15),
  note: 'Checking pod logs and recent deploys',
}

const MOCK_CLAIM_HISTORY = [
  { id: 1, fingerprint: 'fp-001', claimedBy: 'alice', claimedAt: ago(15), note: 'Checking pod logs and recent deploys' },
]

const MOCK_SILENCE_EVENTS = [
  { id: 1, fingerprint: 'fp-001', silenceId: 'sil-xyz', clusterName: 'homelab', action: 'created', performedBy: 'alice', comment: 'Silenced during initial triage', recordedAt: ago(30) },
]

const AUTH_NONE = { mode: 'none', loginUrl: '', setupRequired: false }

// ── Helpers ───────────────────────────────────────────────────────────────────

async function mockBaseAPIs(page: Page, alerts: typeof ALERTS_ACTIVE = ALERTS_ACTIVE) {
  // Auth
  await page.route('**/auth/info', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AUTH_NONE) }),
  )
  await page.route('**/auth/me', (route) => route.fulfill({ status: 401 }))

  // Non-alert APIs
  await page.route('**/api/v1/silences**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([SILENCE_ACTIVE, SILENCE_EXPIRING]) }),
  )
  await page.route('**/api/v1/clusters**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_CLUSTERS) }),
  )
  await page.route('**/api/v1/info**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'v0.8.0' }) }),
  )
  await page.route('**/api/v1/status**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', clusters: 1, alerts: 4, ws_clients: 2 }) }),
  )
  await page.route('**/ws**', (route) => route.abort())

  // ── Alerts routes — LIFO order: generic first (lowest priority), specific last (highest priority) ──
  //
  // Playwright matches routes in reverse registration order (last registered = first checked).
  // Register generic patterns first so specific ones registered later take precedence.

  // 1. Generic live alerts — catches /api/v1/alerts (lowest priority)
  await page.route('**/api/v1/alerts**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(alerts) }),
  )

  // 2. Wildcard per-fingerprint fallbacks (empty data for unknown fingerprints)
  await page.route('**/api/v1/alerts/*/stats**', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  )
  await page.route('**/api/v1/alerts/*/history**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [], total: 0 }) }),
  )
  await page.route('**/api/v1/alerts/*/comments**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  )
  await page.route('**/api/v1/alerts/*/claim**', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  )
  await page.route('**/api/v1/alerts/*/claims/history**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  )
  await page.route('**/api/v1/alerts/*/silence-events**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  )

  // 3. Resolved alerts — wins over generic for ?state=resolved requests
  await page.route('**/api/v1/alerts?state=resolved**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ALERTS_RESOLVED) }),
  )

  // 4. fp-001 specific routes — highest priority (registered last)
  await page.route('**/api/v1/alerts/fp-001/stats**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_STATS) }),
  )
  await page.route('**/api/v1/alerts/fp-001/history**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_HISTORY) }),
  )
  await page.route('**/api/v1/alerts/fp-001/comments**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_COMMENTS) }),
  )
  await page.route('**/api/v1/alerts/fp-001/claim**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_CLAIM) }),
  )
  await page.route('**/api/v1/alerts/fp-001/claims/history**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_CLAIM_HISTORY) }),
  )
  await page.route('**/api/v1/alerts/fp-001/silence-events**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SILENCE_EVENTS) }),
  )
}

// Dismiss the NoAuthNotice overlay so it never blocks subsequent clicks.
// The notice is keyed to localStorage — pre-seed it before the page loads.
async function dismissNoAuthNotice(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('jarvis_noauth_notice_dismissed', '1')
  })
}

async function waitForAlerts(page: Page) {
  // Wait for the live-alerts API response (mocked, returns immediately)
  await page.waitForResponse((r) => r.url().includes('/api/v1/alerts') && !r.url().includes('/api/v1/alerts/'), { timeout: 10_000 }).catch(() => {})
  // Extra settle time for React render + animations
  await page.waitForTimeout(800)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Feature screenshots', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  // ── Main hero screenshot ─────────────────────────────────────────────────

  test('screenshot (hero)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await dismissNoAuthNotice(page)
    await mockBaseAPIs(page)
    await page.goto('/?state=active')
    await waitForAlerts(page)
    await page.screenshot({ path: `${ASSETS_DIR}/screenshot.png`, fullPage: false })
  })

  // ── Card view ────────────────────────────────────────────────────────────

  test('card view', async ({ page }) => {
    await dismissNoAuthNotice(page)
    await mockBaseAPIs(page)
    await page.goto('/?state=active')
    // Ensure card view is active (clear any persisted list mode)
    await page.evaluate(() => localStorage.setItem('jarvis-viewMode', 'card'))
    await page.reload()
    await waitForAlerts(page)
    await page.screenshot({ path: `${ASSETS_DIR}/feature-card-view.png`, fullPage: false })
  })

  // ── List view ────────────────────────────────────────────────────────────

  test('list view', async ({ page }) => {
    await dismissNoAuthNotice(page)
    await mockBaseAPIs(page)
    await page.goto('/?state=active')
    await page.evaluate(() => localStorage.setItem('jarvis-viewMode', 'list'))
    await page.reload()
    await waitForAlerts(page)
    await page.screenshot({ path: `${ASSETS_DIR}/feature-list-view.png`, fullPage: false })
  })

  // ── Label filters ─────────────────────────────────────────────────────────

  test('label filters', async ({ page }) => {
    await dismissNoAuthNotice(page)
    await mockBaseAPIs(page)
    const matchers = JSON.stringify([{ name: 'namespace', operator: '=', value: 'production' }])
    await page.goto(`/?state=active&matchers=${encodeURIComponent(matchers)}`)
    await page.evaluate(() => localStorage.setItem('jarvis-viewMode', 'card'))
    await waitForAlerts(page)
    await page.screenshot({ path: `${ASSETS_DIR}/feature-filter.png`, fullPage: false })
  })

  // ── Settings panel ───────────────────────────────────────────────────────

  test('settings panel', async ({ page }) => {
    await dismissNoAuthNotice(page)
    await mockBaseAPIs(page)
    await page.goto('/?state=active')
    await waitForAlerts(page)
    await page.click('[aria-label="Open settings"]')
    // Wait for the settings sheet/panel to open
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${ASSETS_DIR}/feature-settings-panel.png`, fullPage: false })
  })

  // ── Settings — locked filter chip ────────────────────────────────────────

  test('settings locked filter', async ({ page }) => {
    // Pre-seed both noauth notice dismissal AND a locked default filter
    // before page load — addInitScript runs before every navigation.
    await page.addInitScript(() => {
      localStorage.setItem('jarvis_noauth_notice_dismissed', '1')
      // Zustand persist key is 'jarvis-user-settings', state wrapper required
      localStorage.setItem(
        'jarvis-user-settings',
        JSON.stringify({
          state: { defaultFilters: [{ name: 'env', operator: '=', value: 'prod' }] },
          version: 0,
        }),
      )
    })
    await mockBaseAPIs(page)
    await page.goto('/?state=active')
    await waitForAlerts(page)
    // Screenshot only the sticky header to show the locked filter chip
    const header = page.locator('header').first()
    await header.screenshot({ path: `${ASSETS_DIR}/feature-settings-locked-filter.png` })
  })

  // ── Suppressed view ───────────────────────────────────────────────────────

  test('suppressed view', async ({ page }) => {
    await dismissNoAuthNotice(page)
    await mockBaseAPIs(page)
    await page.goto('/?state=suppressed')
    await waitForAlerts(page)
    await page.screenshot({ path: `${ASSETS_DIR}/feature-suppressed.png`, fullPage: false })
  })

  // ── Resolved view ─────────────────────────────────────────────────────────

  test('resolved view', async ({ page }) => {
    await dismissNoAuthNotice(page)
    await mockBaseAPIs(page)
    await page.goto('/?state=resolved')
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${ASSETS_DIR}/feature-resolved.png`, fullPage: false })
  })

  // ── Alert detail panel ───────────────────────────────────────────────────

  test('alert detail panel', async ({ page }) => {
    await dismissNoAuthNotice(page)
    await mockBaseAPIs(page)
    await page.goto('/?state=active&alert=fp-001')
    await page.evaluate(() => localStorage.setItem('jarvis-viewMode', 'card'))
    await waitForAlerts(page)
    // Wait for the detail panel (sheet) to open
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${ASSETS_DIR}/feature-detail-panel.png`, fullPage: false })
  })

  // ── Alert detail panel — claimed ─────────────────────────────────────────

  test('alert detail panel claimed', async ({ page }) => {
    await dismissNoAuthNotice(page)
    await mockBaseAPIs(page, ALERTS_ACTIVE_WITH_CLAIM)
    await page.goto('/?state=active&alert=fp-001')
    await page.evaluate(() => localStorage.setItem('jarvis-viewMode', 'card'))
    await waitForAlerts(page)
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${ASSETS_DIR}/feature-detail-claimed.png`, fullPage: false })
  })

  // ── Create silence ────────────────────────────────────────────────────────

  test('create silence', async ({ page }) => {
    await dismissNoAuthNotice(page)
    await mockBaseAPIs(page)
    // Route silence preview — alerts matching the default form matchers
    await page.route('**/api/v1/alerts/groups**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    )
    await page.goto('/?state=active')
    await waitForAlerts(page)
    await page.click('button:has-text("Create silence")')
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${ASSETS_DIR}/feature-silence-create.png`, fullPage: false })
  })

  // ── Silence from alert ────────────────────────────────────────────────────

  test('silence from alert', async ({ page }) => {
    await dismissNoAuthNotice(page)
    await mockBaseAPIs(page)
    await page.route('**/api/v1/alerts/groups**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    )
    await page.goto('/?state=active&alert=fp-001')
    await page.evaluate(() => localStorage.setItem('jarvis-viewMode', 'card'))
    await waitForAlerts(page)
    await page.waitForTimeout(600)
    // Click the silence button inside the detail panel
    const silenceBtn = page.getByRole('button', { name: /silence/i }).first()
    await silenceBtn.click()
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${ASSETS_DIR}/feature-silence-from-alert.png`, fullPage: false })
  })

  // ── Expiring silence (shown as active) ───────────────────────────────────

  test('expiring silence alert', async ({ page }) => {
    await dismissNoAuthNotice(page)
    await mockBaseAPIs(page)
    await page.goto('/?state=active')
    await page.evaluate(() => localStorage.setItem('jarvis-viewMode', 'card'))
    await waitForAlerts(page)
    await page.screenshot({ path: `${ASSETS_DIR}/feature-alert-expiring-silence.png`, fullPage: false })
  })

  // ── Expiring silence — detail panel ──────────────────────────────────────

  test('expiring silence detail', async ({ page }) => {
    // fp-003 is the DiskSpaceWarning with expiring silence
    await dismissNoAuthNotice(page)
    await mockBaseAPIs(page)
    await page.route('**/api/v1/alerts/fp-003/stats**', (route) =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ fingerprint: 'fp-003', alertname: 'DiskSpaceWarning', clusterName: 'homelab', firstSeenAt: ago(230), lastSeenAt: ago(1), occurrenceCount: 1 }),
      }),
    )
    await page.route('**/api/v1/alerts/fp-003/history**', (route) =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ events: [{ id: 10, fingerprint: 'fp-003', clusterName: 'homelab', alertmanagerUrl: '', status: 'firing', startsAt: ago(230), endsAt: null, annotations: '{}', recordedAt: ago(230) }], total: 1 }),
      }),
    )
    await page.route('**/api/v1/alerts/fp-003/comments**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    )
    await page.route('**/api/v1/alerts/fp-003/claim**', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
    )
    await page.route('**/api/v1/alerts/fp-003/claims/history**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    )
    await page.route('**/api/v1/alerts/fp-003/silence-events**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    )
    await page.goto('/?state=active&alert=fp-003')
    await page.evaluate(() => localStorage.setItem('jarvis-viewMode', 'card'))
    await waitForAlerts(page)
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${ASSETS_DIR}/feature-alert-expiring-detail.png`, fullPage: false })
  })

  // ── Active silence (suppressed tab) ─────────────────────────────────────

  test('active silence suppressed view', async ({ page }) => {
    await dismissNoAuthNotice(page)
    await mockBaseAPIs(page)
    await page.goto('/?state=suppressed')
    await waitForAlerts(page)
    await page.screenshot({ path: `${ASSETS_DIR}/feature-alert-active-silence.png`, fullPage: false })
  })
})
