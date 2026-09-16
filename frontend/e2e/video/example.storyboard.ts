import { test, expect, JARVIS_BASE_URL } from '../support/fixtures'
import { dismissNoAuthNotice } from '../support/auth'
import { fireWithHeatmapHistory } from '../support/heatmapHistory'
import { manyAlerts } from '../fixtures/alerts'
import { VideoRecorder } from '../video/recorder'
import type { Page } from '@playwright/test'

/**
 * Example storyboard — the v1.12.0 release video. One chapter per visible
 * feature (saved filters, Pin & Hide labels, grouping, card columns, the new
 * header, one-click claims) plus two showcase slides for what the UI can't
 * show. Not run as-is: copy it to e2e/_video/release.video.ts and adapt the
 * scenes to the release. Scene ids must match the segment ids in
 * e2e/_video/release.narration.json (template: e2e/video/example.narration.json).
 * Selectors can drift with UI changes — fix them in the copy, and here when
 * you touch this file anyway.
 * Workflow: .agents/skills/release-video/SKILL.md.
 */

const VERSION = process.env.VIDEO_VERSION ?? '1.12.0'

/** Shared title-card content: intro (also the cover) and outro vary eyebrow/title/cta. */
const CARD = {
  title: 'Saved filters, pinned labels & one-click claims',
  subtitle: 'The open-source web UI for Prometheus Alertmanager',
  features: ['Saved filters', 'Pin & hide labels', 'Group by any label', 'One-click claims'],
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
  defaultCreatorName: '',
  claimAnimationEnabled: true,
  // Nothing pinned or hidden yet — the label chapter changes both on camera.
  labelDisplay: { order: [] as string[], hidden: [] as string[] },
  labelColors: {},
}

/**
 * The e2e stack runs a single Alertmanager; the header's instance list is
 * mocked (frontend only) so the header chapter shows a realistic fleet.
 */
const CLUSTERS = [
  { name: 'dev01', alertmanagerUrl: 'https://alertmanager.dev01.example.com', prometheusUrl: '', healthy: true, alertCount: 3 },
  { name: 'stage', alertmanagerUrl: 'https://alertmanager.stage.example.com', prometheusUrl: '', healthy: true, alertCount: 4 },
  {
    name: 'prod', alertmanagerUrl: 'https://alertmanager.prod.example.com', prometheusUrl: '', healthy: true, alertCount: 6,
    members: [
      { name: 'prod-am-0', url: 'https://am-0.prod.example.com', healthy: true },
      { name: 'prod-am-1', url: 'https://am-1.prod.example.com', healthy: true },
    ],
  },
]

test('release-video', async ({ page, am, jarvis }) => {
  const rec = new VideoRecorder(page)
  const { width, height } = rec.dims

  // ── Deterministic, realistic state (fixtures only — never real data) ──
  await dismissNoAuthNotice(page)
  await rec.installOverlays()
  await page.route('**/api/v1/clusters', (route) => route.fulfill({ json: CLUSTERS }))
  await page.addInitScript(({ s }) => {
    localStorage.setItem('jarvis-username', 'sre-oncall')
    // Seed once. This script runs on every navigation, so re-seeding would
    // silently undo what the demo just changed (a starred default filter,
    // pinned labels) as soon as the storyboard reloads the page.
    if (localStorage.getItem('jarvis-user-settings')) return
    const overrides = { savedFilters: s.savedFilters, labelDisplay: s.labelDisplay }
    localStorage.setItem('jarvis-user-settings', JSON.stringify({
      state: { ...s, overrides, globalDefaults: {}, origin: 'local', syncState: 'idle', anonOverrides: overrides, userMirror: null },
      version: 3,
    }))
  }, { s: SETTINGS })

  // Staggered start times read as a real fleet instead of 14 alerts "just now".
  const base = Date.now()
  const alerts = manyAlerts.map((a, i) => ({ ...a, startsAt: new Date(base - (5 + ((i * 37) % 85)) * 60_000).toISOString() }))
  await fireWithHeatmapHistory(page, am, jarvis, JARVIS_BASE_URL, alerts)
  const live: Array<{ fingerprint: string; labels: Record<string, string> }> = await (await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)).json()
  for (const name of ['HighRequestLatency', 'KubeDeploymentReplicasMismatch']) {
    const a = live.find((x) => x.labels['alertname'] === name)
    if (a) await jarvis.setClaim(a.fingerprint, 'alice', 'Investigating')
  }
  await jarvis.poll()
  // fireWithHeatmapHistory froze the clock before firing; move it past setup so
  // alert and claim times read "N minutes ago", never in the future.
  await page.clock.setFixedTime(new Date(Date.now() + 2 * 60_000))

  await page.goto('/?state=active')
  await expect(page.getByTestId('alert-card').first()).toBeVisible()
  await page.waitForTimeout(800)

  // start() screenshots this opening state for the title cards and the cover.
  await rec.start()

  await rec.scene('intro', null, async () => {
    // The intro card doubles as the YouTube/LinkedIn cover image.
    rec.card({ ...CARD, eyebrow: `Release ${VERSION}` })
    await page.waitForTimeout(2300)
  })
  // No card(null) + pause here: the next scene's chapter slide replaces this
  // card at the same instant, so the video cuts slide to slide instead of
  // flashing the app for half a second in between.

  // ── 1. Saved filters ──
  // Each feature opens with a chapter slide; captions only mark sub-points within a chapter.
  await rec.scene('saved-filters', null, async () => {
    const menu = page.getByTestId('saved-filters-menu')
    await rec.focusOn(24, menu, page.getByTestId('alert-card').first())
    await rec.moveTo(width * 0.25, height * 0.4, 700)
    await rec.clickOn(menu, 800)
    await expect(page.getByTestId('saved-filters-popover')).toBeVisible()
    await page.waitForTimeout(700)
    await rec.clickOn(page.getByRole('button', { name: 'Apply saved filter Critical only' }))
    await page.waitForTimeout(400)
    // Circle what changed: the applied filter chips.
    await rec.highlight([menu, page.getByRole('button', { name: /^Remove filter / }).last()])
    await page.waitForTimeout(600)
  }, { chapter: { title: 'Saved filters', subtitle: 'Your everyday views, one click away' } })

  await rec.scene('saved-filters-default', { title: 'Star your default', sub: 'Applied when you open Jarvis without a filter' }, async () => {
    const menu = page.getByTestId('saved-filters-menu')
    await rec.clickOn(menu, 700)
    const popover = page.getByTestId('saved-filters-popover')
    await expect(popover).toBeVisible()
    await page.waitForTimeout(400)
    await rec.clickOn(popover.getByRole('button', { name: 'Set EU production as default' }), 600)
    await page.waitForTimeout(300)
    await rec.highlight(popover.getByRole('button', { name: 'Unset EU production as default' }), { holdMs: 900 })
    await page.waitForTimeout(700)
    await rec.clickOn(menu, 400)
    await expect(popover).toBeHidden()
    // Prove the claim instead of just stating it. The default only applies when
    // the URL carries no alert-view parameter at all (AlertsPage), so clear the
    // chips first and open the bare URL.
    for (const chip of await page.getByRole('button', { name: /^Remove filter / }).all()) {
      await chip.click()
      await page.waitForTimeout(120)
    }
    await page.goto('/')
    await expect(page.getByTestId('alert-card').first()).toBeVisible()
    await page.waitForTimeout(700)
    const chipAfterReload = page.getByRole('button', { name: /^Remove filter / }).last()
    await expect(chipAfterReload).toBeVisible()
    await rec.focusOn(24, menu, chipAfterReload)
    await rec.highlight(chipAfterReload, { holdMs: 1000 })
    await page.waitForTimeout(1200)
    // Unstar on camera — otherwise the next chapter starts on an unfiltered
    // board right after the voice said the default is always applied.
    await rec.clickOn(menu, 500)
    await expect(popover).toBeVisible()
    await rec.clickOn(popover.getByRole('button', { name: 'Unset EU production as default' }), 500)
    await page.waitForTimeout(300)
    await rec.clickOn(menu, 400)
    for (const chip of await page.getByRole('button', { name: /^Remove filter / }).all()) {
      await chip.click()
      await page.waitForTimeout(150)
    }
    rec.focus(null)
    await page.waitForTimeout(500)
  })

  // ── 2. Pin & hide labels ──
  await rec.scene('labels', null, async () => {
    await openSettings(page, rec)
    const panel = page.getByRole('dialog', { name: 'Settings' })
    const labels = panel.locator('h3', { hasText: 'Labels' }).locator('..')
    await labels.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    const lb = await rec.boxOf(16, labels)
    rec.focus({ ...lb, h: Math.min(lb.h, height * 0.63) })
    await page.waitForTimeout(900)
    // Zoom follows the row that is about to be clicked: the list scrolls, and a
    // zoom pinned to the section would show a click happening off-screen.
    const pinTeam = panel.getByRole('button', { name: 'Pin team', exact: true })
    await pinTeam.scrollIntoViewIfNeeded()
    await rec.focusOn(230, pinTeam)
    await page.waitForTimeout(400)
    await rec.clickOn(pinTeam)
    await page.waitForTimeout(600)
    // Pinning reorders the list: the row jumps into the pinned group at the
    // top, so the zoom has to follow it before the next click up there.
    const swatch = panel.getByRole('button', { name: 'Choose a chip color for team' })
    await swatch.scrollIntoViewIfNeeded()
    await rec.focusOn(230, swatch)
    await page.waitForTimeout(400)
    await rec.clickOn(swatch)
    await page.waitForTimeout(400)
    // The color picker is portaled outside the dialog — zoom on both.
    const picker = page.getByTestId('label-color-picker')
    await expect(picker).toBeVisible()
    await rec.focusOn(40, swatch, picker)
    await page.waitForTimeout(350)
    await rec.clickOn(picker.getByRole('button', { name: 'Color team purple' }), 450)
    await page.waitForTimeout(300)
    // The whole row: pinned into the top group, with its new color.
    const pinnedRow = panel.getByRole('button', { name: 'Unpin team' }).locator('..')
    await rec.focusOn(200, pinnedRow)
    await page.waitForTimeout(300)
    await rec.highlight(pinnedRow, { holdMs: 1000 })
    await page.waitForTimeout(400)
  }, { chapter: { title: 'Pin & hide labels', subtitle: 'Important labels first, the noise out of the way' } })

  await rec.scene('labels-hide', { title: 'Hide what you never read', sub: 'Still filterable, still in the detail panel' }, async () => {
    const panel = page.getByRole('dialog', { name: 'Settings' })
    for (const label of ['test_suite', 'cluster']) {
      const hide = panel.getByRole('button', { name: `Hide ${label}`, exact: true })
      await hide.scrollIntoViewIfNeeded()
      await rec.focusOn(230, hide)
      await page.waitForTimeout(350)
      await rec.clickOn(hide, 550)
      await page.waitForTimeout(400)
    }
    await rec.highlight(panel.getByRole('button', { name: 'Show cluster', exact: true }).locator('..'), { holdMs: 900 })
    // Let the marker fade before the dialog closes: it is drawn at fixed
    // viewport coordinates and would otherwise linger over the board behind it.
    await page.waitForTimeout(1500)
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await page.waitForTimeout(400)
  })

  await rec.scene('labels-chip', { title: 'The "+N" chip opens a popover', sub: 'Revealing labels never reflows the grid' }, async () => {
    const card = page.getByTestId('alert-card').first()
    await rec.focusOn(40, card)
    await rec.moveTo(width * 0.45, height * 0.6, 700)
    await page.waitForTimeout(500)
    // Chips of single-alert groups render in the group header, outside alert-card.
    await rec.highlight(page.locator('span', { has: page.getByText('team:', { exact: true }) }).filter({ visible: true }).first(), { holdMs: 900 })
    await page.waitForTimeout(300)
    const plus = page.getByRole('button', { name: /hidden label/ }).filter({ visible: true }).first()
    await rec.clickOn(plus, 600)
    const popover = page.getByTestId('hidden-labels-popover')
    await expect(popover).toBeVisible()
    await page.waitForTimeout(300)
    await rec.highlight(popover, { pad: 6, holdMs: 1200 })
    await page.waitForTimeout(500)
    await rec.clickOn(plus, 400)
    await page.waitForTimeout(300)
  })

  // ── 3. Group by any label ──
  await rec.scene('grouping', null, async () => {
    const button = page.getByTestId('grouping-control-button')
    const gb = await rec.boxOf(0, button)
    rec.focus({ x: gb.x + gb.w / 2 - 330, y: 0, w: 660, h: 660 })
    await rec.clickOn(button, 800)
    const panel = page.getByTestId('grouping-panel')
    await expect(panel).toBeVisible()
    await page.waitForTimeout(600)
    // The search field, not the whole panel: an ellipse around a tall popover
    // swallows half the screen.
    await rec.highlight(panel.getByPlaceholder('Filter labels…'), { pad: 6, holdMs: 1400 })
    await page.waitForTimeout(600)
  }, { chapter: { title: 'Group by any label', subtitle: 'Right from the toolbar' } })

  await rec.scene('grouping-effect', null, async () => {
    const panel = page.getByTestId('grouping-panel')
    await panel.getByPlaceholder('Filter labels…').pressSequentially('clus', { delay: 110 })
    await page.waitForTimeout(350)
    await rec.clickOn(panel.getByRole('button', { name: /^cluster/ }).first())
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')
    // The effect: sections are now per cluster.
    const section = page.getByRole('button', { name: /^cluster: / }).first()
    await rec.focusOn(120, section)
    await rec.moveTo(width / 2, height / 2, 700)
    // A full-width header: the marker shrinks to its text automatically.
    await rec.highlight(section)
    await page.waitForTimeout(800)
  })

  // ── 4. Multi-column card grid ──
  await rec.scene('columns', null, async () => {
    rec.focus(null)
    await rec.moveTo(width * 0.5, height * 0.75, 800)
    await page.waitForTimeout(1200)
  }, { chapter: { title: 'Multi-column card grid', subtitle: 'Balanced columns, newest group first' } })

  await rec.scene('columns-slider', { title: 'Card columns', sub: 'Auto, or pin it from 1 to 6' }, async () => {
    await openSettings(page, rec)
    const panel = page.getByRole('dialog', { name: 'Settings' })
    const slider = panel.getByLabel('Card columns')
    await slider.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await rec.focusOn(120, slider)
    const sb = await rec.boxOf(0, slider)
    await rec.moveTo(sb.x + 4, sb.y + sb.h / 2, 600)
    await page.mouse.down()
    await rec.moveTo(sb.x + (sb.w * 2) / 6, sb.y + sb.h / 2, 900)
    await page.mouse.up()
    // The drag ends on one real mouse move, so nail the value the video claims.
    if ((await slider.inputValue()) !== '2') await slider.fill('2')
    await page.waitForTimeout(400)
    await rec.highlight(slider.locator('..'), { holdMs: 900 })
    await page.waitForTimeout(400)
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    rec.focus(null)
    await page.waitForTimeout(1200)
  })

  // ── 5. Redesigned header ──
  await rec.scene('header', null, async () => {
    const instances = page.getByLabel(/^Instances /).first()
    await rec.focusOn(360, instances)
    const box = await rec.boxOf(0, instances)
    await rec.moveTo(box.x + box.w / 2, box.y + box.h / 2, 900)
    const popover = page.getByRole('tooltip').filter({ hasText: 'Connected Instances' })
    await expect(popover).toBeVisible()
    await page.waitForTimeout(400)
    await rec.focusOn(40, instances, popover)
    await page.waitForTimeout(400)
    await rec.highlight(popover, { pad: 6, holdMs: 1600 })
    await page.waitForTimeout(600)
  }, { chapter: { title: 'A quieter header', subtitle: 'Cluster health on hover, one menu for everything else' } })

  await rec.scene('header-menu', { title: 'One user menu', sub: 'Settings, theme and account' }, async () => {
    const userMenu = page.getByTestId('user-menu')
    rec.focus(await rec.boxOf(300, userMenu), 1.5)
    await rec.clickOn(userMenu, 800)
    const menuPanel = page.getByTestId('user-menu-panel')
    await expect(menuPanel).toBeVisible()
    await page.waitForTimeout(400)
    await rec.highlight(menuPanel, { pad: 6, holdMs: 900 })
    await page.waitForTimeout(300)
    // Theme toggle stays open after the click — switch to light and back.
    await rec.clickOn(menuPanel.getByRole('button', { name: 'Light mode' }), 300)
    rec.focus(null)
    await page.waitForTimeout(1400)
    await rec.clickOn(page.getByTestId('user-menu'), 500)
    await rec.clickOn(page.getByTestId('user-menu-panel').getByRole('button', { name: 'Dark mode' }), 300)
    await page.waitForTimeout(600)
    await page.mouse.move(width * 0.5, height * 0.6)
    await page.waitForTimeout(400)
  })

  // ── 6. One-click claims ──
  await rec.scene('claims', null, async () => {
    rec.focus(null)
    // Clicking the summary opens the detail panel; the card title is a group header.
    await rec.clickOn(page.getByTestId('alert-card').getByText(/is crash looping$/).first(), 800)
    const detail = page.getByTestId('detail-panel')
    await expect(detail).toBeVisible()
    await page.waitForTimeout(400)
    const cb = await rec.boxOf(28, page.getByTestId('claim-button'), detail.getByText('KubePodCrashLooping', { exact: true }).first())
    rec.focus({ x: cb.x, y: cb.y - 40, w: cb.w, h: cb.w })
    await page.waitForTimeout(900)
    await rec.clickOn(page.getByTestId('claim-button'))
    await expect(page.getByTestId('detail-claim-badge')).toBeVisible()
    await page.waitForTimeout(250)
    await rec.highlight(page.getByTestId('detail-claim-badge'))
    await page.waitForTimeout(700)
  }, { chapter: { title: 'One-click claims', subtitle: 'Open an alert — claiming it is one click, no form' } })

  await rec.scene('claims-note', { title: 'Add a note if you want one', sub: 'Never required' }, async () => {
    const detail = page.getByTestId('detail-panel')
    await rec.clickOn(detail.getByTestId('claim-edit-note-button').first(), 600)
    const form = detail.getByTestId('claim-edit-note-form')
    await expect(form).toBeVisible()
    await page.waitForTimeout(300)
    await form.getByRole('textbox').pressSequentially('Restarting the pod', { delay: 55 })
    await page.waitForTimeout(300)
    await rec.clickOn(form.getByRole('button', { name: /^Save/ }), 450)
    await expect(detail.getByTestId('detail-claim-note')).toBeVisible()
    await page.waitForTimeout(300)
    await rec.highlight(detail.getByTestId('detail-claim-note'), { holdMs: 900 })
    await page.waitForTimeout(1400)
    // The same note where the team actually looks: on the card in the board.
    rec.focus(null)
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    await page.waitForTimeout(400)
    const noteCard = page.getByTestId('alert-card').filter({ hasText: 'Restarting the pod' }).first()
    await noteCard.scrollIntoViewIfNeeded()
    await rec.focusOn(60, noteCard)
    await page.waitForTimeout(500)
    await rec.highlight(noteCard.getByText('Restarting the pod').first(), { pad: 10, holdMs: 1400 })
    await page.waitForTimeout(900)
    rec.focus(null)
  })

  // ── Showcase: what the UI can't demonstrate ──
  await rec.scene('more', null, async () => {
    rec.card({
      eyebrow: 'Also in this release',
      title: 'Shorter links, portable settings, calmer cards',
      tiles: [
        { title: 'Alertmanager-style filter URLs', text: 'The matcher syntax you already know — about 2.5× shorter than before.', code: '?filter={severity="critical",namespace=~"prod-.*"}' },
        { title: 'Settings follow your account', text: 'Signed in, your preferences move with you across browsers and devices.' },
        { title: 'Calmer cards and rows', text: 'Distinguishing labels lead, group-wide labels are muted, row heights stay even.' },
      ],
    })
    await page.waitForTimeout(2500)
  })

  await rec.scene('reliability', null, async () => {
    rec.card({
      eyebrow: 'Fixed',
      title: 'A steadier history on PostgreSQL',
      tiles: [
        { title: 'Claims stop flickering', text: 'Every replica applies a claim immediately, whichever pod the next request hits.' },
        { title: 'Resolved keeps its text', text: 'Resolved events store their annotations again — summary and description stay.' },
        { title: 'The poll loop keeps going', text: 'History writes give up after a bounded wait instead of stalling a pod for good.' },
      ],
    })
    await page.waitForTimeout(2200)
  })

  await rec.scene('outro', null, async () => {
    rec.card({ ...CARD, eyebrow: 'Open source · Apache-2.0', title: `Try Jarvis ${VERSION}`, cta: 'github.com/kj187/jarvis' })
    await page.waitForTimeout(3000)
  })

  await rec.finish()
})

/** Opens the Settings dialog through the user menu (it opens on hover and closes on mouse-leave). */
async function openSettings(page: Page, rec: VideoRecorder): Promise<void> {
  const userMenu = page.getByTestId('user-menu')
  rec.focus(await rec.boxOf(260, userMenu), 1.4)
  await rec.clickOn(userMenu, 800)
  await page.waitForTimeout(400)
  await rec.clickOn(page.getByTestId('user-menu-panel').getByRole('button', { name: 'Settings' }), 300)
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
}
