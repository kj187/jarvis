import { test, expect, JARVIS_BASE_URL } from '../support/fixtures'
import { dismissNoAuthNotice } from '../support/auth'
import { fireWithHeatmapHistory } from '../support/heatmapHistory'
import { manyAlerts } from '../fixtures/alerts'
import { VideoRecorder } from '../video/recorder'
import type { Page } from '@playwright/test'

/**
 * Product introduction video ("Meet Jarvis") — not tied to a release.
 * Copy to e2e/_video/intro.video.ts (and intro.narration.json next to it)
 * and run `make release-video VERSION=intro PROJECT=intro`
 * (writes ~/Downloads/jarvis-intro-video/jarvis-intro-{youtube,linkedin}.mp4).
 * Story: problem → every cluster, live → find → understand → act as a team →
 * silence with confidence (the longest chapter) → ready for production → call to action.
 * Workflow: .agents/skills/release-video/SKILL.md.
 */

const INTRO = {
  title: 'The Alertmanager UI for teams that act on alerts',
  subtitle: 'Open source · Self-hosted · One container',
  features: ['Every cluster, live', 'Full alert history', 'Claims & comments', 'Silences with a preview'],
}

const SETTINGS = {
  theme: 'dark' as const,
  timeFormat: 'relative' as const,
  defaultViewMode: 'card' as const,
  groupByLabel: 'severity',
  cardColumns: 'auto' as const,
  savedFilters: [
    { name: 'Critical only', matchers: [{ name: 'severity', operator: '=', value: 'critical' }], isDefault: false },
    { name: 'Team platform', matchers: [{ name: 'team', operator: '=', value: 'platform' }], isDefault: false },
    { name: 'EU production', matchers: [{ name: 'cluster', operator: '=', value: 'eu-west-1-prod' }], isDefault: false },
  ],
  resolvedPageSize: 25,
  defaultSilenceDurationMinutes: 60,
  defaultCreatorName: 'sre-oncall',
  claimAnimationEnabled: false,
  labelDisplay: { order: ['@cluster'], hidden: ['test_suite'] },
  labelColors: { team: 'purple' },
}

/**
 * The e2e stack runs a single Alertmanager; the header's instance list is
 * mocked (frontend only) so the video shows a realistic dev → prod fleet.
 */
const CLUSTERS = [
  { name: 'dev01', alertmanagerUrl: 'https://alertmanager.dev01.example.com', prometheusUrl: '', healthy: true, alertCount: 3 },
  { name: 'dev02', alertmanagerUrl: 'https://alertmanager.dev02.example.com', prometheusUrl: '', healthy: true, alertCount: 2 },
  { name: 'stage', alertmanagerUrl: 'https://alertmanager.stage.example.com', prometheusUrl: '', healthy: true, alertCount: 4 },
  {
    name: 'prod', alertmanagerUrl: 'https://alertmanager.prod.example.com', prometheusUrl: '', healthy: true, alertCount: 6,
    members: [
      { name: 'prod-am-0', url: 'https://am-0.prod.example.com', healthy: true },
      { name: 'prod-am-1', url: 'https://am-1.prod.example.com', healthy: true },
    ],
  },
]

/** Fired mid-video to show a live update. */
const LIVE_ALERT = {
  labels: { alertname: 'PaymentGatewayErrors', severity: 'critical', cluster: 'eu-west-1-prod', namespace: 'payments', team: 'payments', service: 'payment-gateway' },
  annotations: { summary: 'Payment gateway error rate is 12%', description: 'HTTP 5xx on /checkout exceeds 5% for 5 minutes.' },
}

/** Silence form dialog: create from an alert, a group or the header. */
const silenceDialog = (page: Page) => page.getByRole('dialog', { name: /silence/i }).last()

test('intro-video', async ({ page, am, jarvis }) => {
  const rec = new VideoRecorder(page)
  const { width, height } = rec.dims

  await dismissNoAuthNotice(page)
  await rec.installOverlays()
  await page.route('**/api/v1/clusters', (route) => route.fulfill({ json: CLUSTERS }))
  await page.addInitScript(({ s }) => {
    localStorage.setItem('jarvis-username', 'sre-oncall')
    // Seed once: this script runs on every navigation, and re-seeding would
    // undo anything the demo changed before a reload.
    if (localStorage.getItem('jarvis-user-settings')) return
    const overrides = { savedFilters: s.savedFilters, labelDisplay: s.labelDisplay, labelColors: s.labelColors, claimAnimationEnabled: false }
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: { ...s, overrides, globalDefaults: {}, origin: 'local', syncState: 'idle', anonOverrides: overrides, userMirror: null },
      version: 3,
    }))
  }, { s: SETTINGS })

  const base = Date.now()
  const alerts = manyAlerts.map((a, i) => ({ ...a, startsAt: new Date(base - (5 + ((i * 37) % 85)) * 60_000).toISOString() }))
  // A second replica of one alert, so its card holds two alerts: that card's
  // silence menu is the card view's "silence the whole group" action.
  const lagIndex = alerts.findIndex((a) => a.labels.alertname === 'PostgresReplicationLag')
  if (lagIndex >= 0) {
    const lag = alerts[lagIndex]
    alerts.push({
      ...lag,
      labels: { ...lag.labels, instance: 'postgres-replica-1' },
      annotations: { ...lag.annotations, summary: 'Postgres replica lag is 96s' },
      startsAt: new Date(base - 22 * 60_000).toISOString(),
    })
  }
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, alerts)
  const live: Array<{ fingerprint: string; labels: Record<string, string> }> = await (await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)).json()
  const claimed = live.find((x) => x.labels['alertname'] === 'HighRequestLatency')
  if (claimed) await jarvis.setClaim(claimed.fingerprint, 'alice', 'Investigating')
  // Templates survive jarvis.reset() — clear them so every format run starts clean.
  const existing: Array<{ id: string }> = await (await fetch(`${JARVIS_BASE_URL}/api/v1/silence-templates`)).json()
  for (const t of existing) await fetch(`${JARVIS_BASE_URL}/api/v1/silence-templates/${t.id}`, { method: 'DELETE' })
  await jarvis.createTemplate('Nightly DB maintenance', [{ name: 'team', operator: '=', value: 'data' }], 'Nightly database maintenance window')
  await jarvis.createTemplate('Node reboot', [{ name: 'alertname', operator: '=', value: 'KubeNodeNotReady' }], 'Planned node reboot')
  await jarvis.poll()
  // Slightly ahead of setup, so seeded claims read "N minutes ago" — but not so
  // far that silences created by the browser later start in the future (pending).
  await page.clock.setFixedTime(new Date(Date.now() + 45_000))

  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()
  await page.waitForTimeout(800)
  await rec.start()

  // ── Hook ──
  await rec.scene('intro', null, async () => {
    rec.card({ ...INTRO, eyebrow: 'Meet Jarvis' })
    await page.waitForTimeout(2500)
  })
  // No card(null) + pause here: the next scene's chapter slide replaces this
  // card at the same instant, so the video cuts slide to slide instead of
  // flashing the app for half a second in between.

  // ── 1. Every cluster, live ──
  await rec.scene('clusters', null, async () => {
    const instances = page.getByLabel(/^Instances /)
    await rec.focusOn(360, instances)
    const box = await rec.boxOf(0, instances)
    await rec.moveTo(box.x + box.w / 2, box.y + box.h / 2, 900)
    const popover = page.getByRole('tooltip').filter({ hasText: 'Connected Instances' })
    await expect(popover).toBeVisible()
    await page.waitForTimeout(400)
    await rec.focusOn(40, instances, popover)
    await page.waitForTimeout(500)
    await rec.highlight(popover, { pad: 6, holdMs: 2200 })
    await page.waitForTimeout(1800)
  }, { chapter: { title: 'Every cluster, live', subtitle: 'All your Alertmanagers in one view — updates pushed in real time' } })

  await rec.scene('live', { title: 'Live updates', sub: 'A new alert fires — no reload' }, async () => {
    await rec.moveTo(width * 0.45, height * 0.55, 700)
    rec.focus(null)
    await page.waitForTimeout(1200)
    await am.fire([{ ...LIVE_ALERT, startsAt: new Date(Date.now() - 20_000).toISOString() }])
    await jarvis.poll()
    const fresh = page.getByTestId('alert-card').filter({ hasText: 'Payment gateway error rate' }).first()
    await expect(fresh).toBeVisible({ timeout: 10_000 })
    await rec.focusOn(60, fresh)
    await page.waitForTimeout(500)
    await rec.highlight(fresh, { pad: 4, holdMs: 1600 })
    await page.waitForTimeout(900)
  })

  // ── 2. Find what matters ──
  await rec.scene('search', null, async () => {
    rec.focus(null)
    const toggle = page.getByRole('button', { name: 'Toggle search' })
    await rec.focusOn(300, toggle)
    await rec.clickOn(toggle, 800)
    const search = page.getByRole('textbox', { name: 'Search alerts' })
    await expect(search).toBeVisible()
    await search.pressSequentially('kafka', { delay: 140 })
    await expect(page.getByTestId('alert-card')).toHaveCount(1)
    await page.waitForTimeout(300)
    // Circle what was typed; the single remaining alert is the result.
    await rec.highlight(search, { pad: 4, holdMs: 1200 })
    await page.waitForTimeout(400)
    await rec.focusOn(80, page.getByTestId('alert-card').first())
    await page.waitForTimeout(1600)
    await rec.clickOn(page.getByRole('button', { name: 'Close search' }))
    rec.focus(null)
    await page.waitForTimeout(600)
  }, { chapter: { title: 'Find what matters', subtitle: 'Search, filter by any label, save your views' } })

  await rec.scene('filters', { title: 'Saved filters', sub: 'Your everyday views, one click away' }, async () => {
    const menu = page.getByTestId('saved-filters-menu')
    await rec.focusOn(24, menu, page.getByTestId('alert-card').first())
    await rec.clickOn(menu, 700)
    await page.waitForTimeout(700)
    await rec.clickOn(page.getByRole('button', { name: 'Apply saved filter Critical only' }))
    await page.waitForTimeout(400)
    await rec.highlight([menu, page.getByRole('button', { name: /^Remove filter / }).last()])
    await page.waitForTimeout(1400)
    await rec.clickOn(page.getByRole('button', { name: /^Remove filter / }).first())
    await page.waitForTimeout(500)
  })

  // ── 3. Understand every alert ──
  await rec.scene('understand', null, async () => {
    rec.focus(null)
    await rec.clickOn(page.getByTestId('alert-card').getByText(/is crash looping$/).first(), 800)
    const detail = page.getByTestId('detail-panel')
    await expect(detail).toBeVisible()
    await page.waitForTimeout(500)
    const heatmap = detail.getByTestId('detail-heatmap-section')
    await rec.focusOn(40, heatmap, detail.getByText('KubePodCrashLooping', { exact: true }).first())
    await page.waitForTimeout(700)
    await rec.highlight(heatmap, { pad: 4, holdMs: 1400 })
    await page.waitForTimeout(700)
    await rec.clickOn(detail.getByTestId('detail-tab-history'))
    await page.waitForTimeout(600)
    await rec.focusOn(40, detail.getByTestId('detail-tab-history'), heatmap)
    await page.waitForTimeout(1200)
  }, { chapter: { title: 'Understand every alert', subtitle: 'Labels, links, heatmap and the full lifecycle' } })

  // ── 4. Act as a team ──
  await rec.scene('claim', null, async () => {
    const detail = page.getByTestId('detail-panel')
    const claim = page.getByTestId('claim-button')
    await rec.focusOn(280, claim)
    await page.waitForTimeout(500)
    await rec.clickOn(claim)
    await expect(page.getByTestId('detail-claim-badge')).toBeVisible()
    await page.waitForTimeout(250)
    await rec.highlight(page.getByTestId('detail-claim-badge'), { holdMs: 900 })
    await page.waitForTimeout(500)
    // Add a note to the claim afterwards.
    await rec.clickOn(detail.getByTestId('claim-edit-note-button').first())
    const noteForm = detail.getByTestId('claim-edit-note-form')
    await expect(noteForm).toBeVisible()
    await rec.focusOn(60, noteForm, page.getByTestId('detail-claim-badge'))
    const note = noteForm.getByPlaceholder('Note')
    await rec.clickOn(note, 400)
    await note.pressSequentially('Rolling back payment-api to v2.3.1', { delay: 45 })
    await page.waitForTimeout(300)
    await rec.clickOn(noteForm.getByRole('button', { name: 'Save' }))
    const savedNote = detail.getByTestId('detail-claim-note')
    await expect(savedNote).toBeVisible()
    await page.waitForTimeout(300)
    await rec.highlight(savedNote, { pad: 4, holdMs: 1000 })
    await page.waitForTimeout(1300)
    // The same note where the team actually looks: on the card in the board.
    rec.focus(null)
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    await page.waitForTimeout(400)
    const noteCard = page.getByTestId('alert-card').filter({ hasText: 'Rolling back payment-api' }).first()
    await noteCard.scrollIntoViewIfNeeded()
    await rec.focusOn(60, noteCard)
    await page.waitForTimeout(500)
    await rec.highlight(noteCard.getByText('Rolling back payment-api to v2.3.1').first(), { pad: 10, holdMs: 1300 })
    await page.waitForTimeout(800)
  }, { chapter: { title: 'Act as a team', subtitle: 'Claim alerts, leave notes and comments' } })

  await rec.scene('comments', { title: 'Comments', sub: 'History that stays with the alert' }, async () => {
    rec.focus(null)
    await rec.clickOn(page.getByTestId('alert-card').getByText(/is crash looping$/).first(), 700)
    const detail = page.getByTestId('detail-panel')
    await expect(detail).toBeVisible()
    await page.waitForTimeout(400)
    await rec.clickOn(detail.getByTestId('detail-tab-comments'))
    const input = detail.getByTestId('detail-comment-input')
    await expect(input).toBeVisible()
    const nameInput = detail.getByPlaceholder('Your name')
    if (await nameInput.isVisible()) await nameInput.fill('sre-oncall')
    await rec.focusOn(40, input, detail.getByTestId('detail-comment-submit'))
    await rec.clickOn(input, 500)
    await input.pressSequentially('OOMKilled since the 2.4 rollout – memory limit raised to 512Mi.', { delay: 35 })
    await page.waitForTimeout(300)
    await rec.clickOn(detail.getByTestId('detail-comment-submit'))
    const comment = detail.getByTestId('detail-comment-item').filter({ hasText: 'OOMKilled' }).first()
    await expect(comment).toBeVisible({ timeout: 8_000 })
    await rec.focusOn(80, comment)
    await page.waitForTimeout(300)
    await rec.highlight(comment, { pad: 4, holdMs: 1400 })
    await page.waitForTimeout(900)
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    rec.focus(null)
  })

  // ── 5. Silence with confidence (the heart of Jarvis — takes its time) ──
  const silencesTab = page.getByRole('button', { name: /^Silences/ })

  await rec.scene('fast-silence', null, async () => {
    // A card near the top: the Fast-Silence menu opens below its button and must stay in view.
    const card = page.getByTestId('alert-card').filter({ hasText: 'Disk on worker-node-07' }).first()
    const ack = card.getByTestId('alert-ack-button')
    await rec.focusOn(170, ack)
    const b = await rec.boxOf(0, ack)
    await rec.moveTo(b.x + b.w / 2, b.y + b.h / 2, 900)
    const menu = page.getByTestId('alert-ack-menu')
    await expect(menu).toBeVisible()
    await page.waitForTimeout(700)
    await rec.highlight(menu.getByTestId('alert-ack-option').first().locator('..'), { pad: 4, holdMs: 1000 })
    await page.waitForTimeout(300)
    await rec.clickOn(menu.getByTestId('alert-ack-option').filter({ hasText: /^1h$/ }))
    await expect(silencesTab).toContainText('1', { timeout: 8_000 })
    await rec.focusOn(260, silencesTab)
    await page.waitForTimeout(400)
    await rec.highlight(silencesTab, { holdMs: 1000 })
    await page.waitForTimeout(900)
    rec.focus(null)
  }, { chapter: { title: 'Silence with confidence', subtitle: 'Fast-Silence, full form with preview, groups and templates' } })

  await rec.scene('silence-form', { title: 'Silence with a preview', sub: 'See affected alerts before you create it' }, async () => {
    const card = page.getByTestId('alert-card').filter({ hasText: 'is crash looping' }).first()
    const ack = card.getByTestId('alert-ack-button')
    await rec.focusOn(200, ack)
    const b = await rec.boxOf(0, ack)
    await rec.moveTo(b.x + b.w / 2, b.y + b.h / 2, 800)
    const menu = page.getByTestId('alert-ack-menu')
    await expect(menu).toBeVisible()
    await page.waitForTimeout(400)
    await rec.clickOn(menu.getByTestId('alert-ack-open-form'), 400)
    const dialog = silenceDialog(page)
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(500)
    await rec.focusOn(20, dialog)
    await page.waitForTimeout(800)
    const affected = dialog.getByTitle('Click to show/hide affected alerts')
    await rec.clickOn(affected)
    await page.waitForTimeout(500)
    await rec.highlight(affected, { pad: 4, holdMs: 1300 })
    await page.waitForTimeout(500)
    const name = dialog.getByPlaceholder('Your name')
    if (await name.isVisible() && !(await name.inputValue())) await name.fill('sre-oncall')
    const reason = dialog.getByPlaceholder('Reason for the silence…')
    await rec.clickOn(reason, 500)
    await reason.pressSequentially('Rolling restart of payment-api', { delay: 40 })
    await page.waitForTimeout(300)
    await rec.clickOn(dialog.getByRole('button', { name: 'Preview' }))
    await page.waitForTimeout(1200)
    await rec.clickOn(dialog.getByRole('button', { name: 'Create' }))
    await rec.clickOn(dialog.getByRole('button', { name: 'Close', exact: true }).last(), 500)
    await expect(dialog).toBeHidden()
    rec.focus(null)
    await page.waitForTimeout(500)
  })

  await rec.scene('silence-group', { title: 'Silence a whole group', sub: 'Every alert of a group at once' }, async () => {
    // Card view has its own group action: the card header's silence menu acts
    // on every alert of the card — no detour through the list view. The header
    // sits outside the alert-card elements, so match the button itself, and
    // open the menu by hovering (a click on the trigger would toggle it shut).
    const groupButton = page.getByRole('button', { name: /^Silence options for \d+ alerts$/ }).first()
    await groupButton.scrollIntoViewIfNeeded()
    await expect(groupButton).toBeVisible()
    await rec.focusOn(260, groupButton)
    await page.waitForTimeout(400)
    const b = await rec.boxOf(0, groupButton)
    await rec.moveTo(b.x + b.w / 2, b.y + b.h / 2, 900)
    const menu = page.getByTestId('alert-ack-menu')
    await expect(menu).toBeVisible()
    await page.waitForTimeout(500)
    await rec.clickOn(menu.getByTestId('alert-ack-open-form'), 400)
    const dialog = silenceDialog(page)
    await expect(dialog).toBeVisible()
    await rec.focusOn(20, dialog)
    await page.waitForTimeout(700)
    const affected = dialog.getByTitle('Click to show/hide affected alerts')
    await rec.clickOn(affected)
    await page.waitForTimeout(400)
    await rec.highlight(affected, { pad: 4, holdMs: 1200 })
    const name = dialog.getByPlaceholder('Your name')
    if (await name.isVisible() && !(await name.inputValue())) await name.fill('sre-oncall')
    await dialog.getByPlaceholder('Reason for the silence…').fill('Planned backup window')
    await page.waitForTimeout(400)
    await rec.clickOn(dialog.getByRole('button', { name: 'Preview' }))
    await page.waitForTimeout(900)
    await rec.clickOn(dialog.getByRole('button', { name: 'Create' }))
    await rec.clickOn(dialog.getByRole('button', { name: 'Close', exact: true }).last(), 500)
    await expect(dialog).toBeHidden()
    rec.focus(null)
    await page.waitForTimeout(500)
  })

  await rec.scene('silence-templates', { title: 'Silence templates', sub: 'Reusable matchers for recurring maintenance' }, async () => {
    const create = page.getByRole('button', { name: 'Create silence' })
    await rec.focusOn(300, create)
    await rec.clickOn(create, 700)
    const dialog = silenceDialog(page)
    await expect(dialog).toBeVisible()
    await rec.focusOn(20, dialog)
    await page.waitForTimeout(700)
    const select = dialog.locator('select').filter({ has: page.locator('option', { hasText: 'Nightly DB maintenance' }) })
    const sb = await rec.boxOf(0, select)
    await rec.moveTo(sb.x + sb.w / 2, sb.y + sb.h / 2, 700)
    await select.selectOption({ label: 'Nightly DB maintenance' })
    await page.waitForTimeout(500)
    await rec.highlight([select, dialog.getByText(/loaded from template/)], { pad: 4, holdMs: 1400 })
    await page.waitForTimeout(600)
    await rec.highlight(dialog.getByPlaceholder('Reason for the silence…'), { pad: 4, holdMs: 1200 })
    await page.waitForTimeout(900)
    await rec.clickOn(dialog.getByRole('button', { name: 'Cancel' }))
    await expect(dialog).toBeHidden()
    rec.focus(null)
  })

  await rec.scene('silences-page', { title: 'All silences in one place', sub: 'Extend, edit, expire' }, async () => {
    await rec.focusOn(260, silencesTab)
    await rec.clickOn(silencesTab, 700)
    await page.waitForTimeout(900)
    rec.focus(null)
    const first = page.getByTestId('silence-card').first()
    await expect(first).toBeVisible({ timeout: 8_000 })
    await page.waitForTimeout(500)
    await rec.focusOn(60, first)
    await page.waitForTimeout(500)
    await rec.highlight(first, { pad: 4, holdMs: 1400 })
    await page.waitForTimeout(900)
  })

  // ── 6. Ready for production ──
  await rec.scene('auth', null, async () => {
    rec.card({
      eyebrow: 'Authentication',
      title: 'Secure it your way',
      tiles: [
        { title: 'No login', text: 'Open access for trusted networks and quick starts.', code: 'JARVIS_AUTH_PROVIDER=none' },
        { title: 'Built-in users', text: 'Local accounts with roles and an admin panel.', code: 'JARVIS_AUTH_PROVIDER=internal' },
        { title: 'Single sign-on', text: 'OIDC with Keycloak, Authentik, Dex or any other provider.', code: 'JARVIS_AUTH_PROVIDER=oidc' },
      ],
    })
    await page.waitForTimeout(2500)
  }, { chapter: { title: 'Ready for production', subtitle: 'Authentication, deployment and supply-chain security' } })

  await rec.scene('deploy', null, async () => {
    rec.card({
      eyebrow: 'Deployment',
      title: 'From one container to high availability',
      tiles: [
        { title: 'One container', text: 'Frontend embedded in the Go binary, SQLite by default.', code: 'image: ghcr.io/kj187/jarvis:1.12.0' },
        { title: 'PostgreSQL', text: 'Shared history for several replicas with leader election.', code: 'JARVIS_DB_DSN=postgres://…' },
        { title: 'Kubernetes', text: 'Official Helm chart for highly available setups.', code: 'helm install jarvis oci://ghcr.io/kj187/charts/jarvis' },
      ],
    })
    await page.waitForTimeout(2500)
  })

  await rec.scene('security', null, async () => {
    rec.card({
      eyebrow: 'Supply chain',
      title: 'Signed, documented, hardened',
      tiles: [
        { title: 'Signed images', text: 'Keyless cosign signatures and build provenance.', code: 'cosign verify ghcr.io/kj187/jarvis:1.12.0' },
        { title: 'SBOM', text: 'An SPDX software bill of materials with every release.' },
        { title: 'Hardened runtime', text: 'Distroless image, read-only filesystem, strict CSP.' },
      ],
    })
    await page.waitForTimeout(2500)
  })

  // ── Call to action (holds as the last frame) ──
  await rec.scene('outro', null, async () => {
    rec.card({ ...INTRO, eyebrow: 'Open source · Apache-2.0', title: 'Try Jarvis today', cta: 'github.com/kj187/jarvis' })
    await page.waitForTimeout(3000)
  })

  await rec.finish()
})
