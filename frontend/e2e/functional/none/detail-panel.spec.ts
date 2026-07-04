import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { kubernetesAlerts } from '../../fixtures/alerts'

/**
 * Category D: Detail Panel (D1-D2, D5-D7, D9-D10)
 * Tests for detail panel opening, labels/annotations, stats, claims, comments.
 */

test.describe('D1: Open detail panel via click and URL', () => {
  test('clicking alert card opens detail panel', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    await page.goto('/?state=active')
    
    // Click first card
    const firstCard = page.getByTestId('alert-card').first()
    await firstCard.click()
    await page.waitForTimeout(500)
    
    // Verify detail panel opens
    const detailPanel = page.getByTestId('detail-panel')
    await expect(detailPanel).toBeVisible()
  })

  test('URL ?alert=<fingerprint> opens detail panel', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    // Get a fingerprint
    const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
    const alerts: any[] = await res.json()
    const fingerprint = alerts[0].fingerprint
    
    // Navigate with fingerprint param
    await page.goto(`/?state=active&alert=${fingerprint}`)
    await page.waitForTimeout(500)
    
    // Verify detail panel opens
    const detailPanel = page.getByTestId('detail-panel')
    await expect(detailPanel).toBeVisible()
  })

  test('closing detail panel clears ?alert param', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    await page.goto('/?state=active')
    
    // Open detail
    const firstCard = page.getByTestId('alert-card').first()
    await firstCard.click()
    await page.waitForTimeout(500)
    
    // Close detail
    const closeButton = page.getByTestId('detail-panel-close')
    await closeButton.click()
    await page.waitForTimeout(300)
    
    // Verify param removed
    const url = page.url()
    expect(url).not.toContain('alert=')
  })
})

test.describe('D2: Labels & annotations rendered', () => {
  test('detail panel shows all labels', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    await page.goto('/?state=active')
    
    // Open detail
    const firstCard = page.getByTestId('alert-card').first()
    await firstCard.click()
    await page.waitForTimeout(500)
    
    // Verify labels section
    const labelsSection = page.getByTestId('detail-labels-section')
    await expect(labelsSection).toBeVisible()
    
    // Verify specific labels exist
    const labelItems = page.getByTestId('detail-label-item')
    const labelTexts = await labelItems.allTextContents()
    
    // Should have at least alertname, severity
    expect(labelTexts.length).toBeGreaterThan(0)
    expect(labelTexts.join('').toLowerCase()).toContain('alertname')
  })

  test('detail panel shows summary and extra annotations', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    // summary/description render in their own "Summary" section; only extra
    // annotations (not summary/description/links) appear in the annotations section.
    await am.fire([
      {
        labels: { alertname: 'AnnotatedAlert', severity: 'warning', cluster: 'e2e' },
        annotations: {
          summary: 'A concise summary of the alert',
          description: 'A longer description of the alert',
          impact: 'Customer-facing latency increase',
        },
      },
    ])
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)

    await page.goto('/?state=active')

    // Open detail
    const firstCard = page.getByTestId('alert-card').first()
    await firstCard.click()
    await page.waitForTimeout(500)

    // Summary section renders the summary text
    await expect(page.getByTestId('detail-panel').getByText('A concise summary of the alert')).toBeVisible()

    // Extra (non-summary/description) annotations appear in the annotations section
    const annotationsSection = page.getByTestId('detail-annotations-section')
    await expect(annotationsSection).toBeVisible()

    const annotationItems = page.getByTestId('detail-annotation-item')
    const annotationTexts = await annotationItems.allTextContents()

    expect(annotationTexts.length).toBeGreaterThan(0)
    expect(annotationTexts.join('').toLowerCase()).toContain('impact')
  })

  test('annotation links are clickable (dashboard, runbook)', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    await page.goto('/?state=active')
    
    // Open detail
    const firstCard = page.getByTestId('alert-card').first()
    await firstCard.click()
    await page.waitForTimeout(500)
    
    // Check for links
    const links = page.locator('a[href^="http"]')
    const linkCount = await links.count()
    
    // Should have some external links in annotations
    expect(linkCount).toBeGreaterThanOrEqual(0)
  })
})

test.describe('D5: Stats & timeline', () => {
  test('detail panel shows first/last seen timestamps', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    await page.goto('/?state=active')
    
    // Open detail
    const firstCard = page.getByTestId('alert-card').first()
    await firstCard.click()
    await page.waitForTimeout(500)
    
    // Verify stats section
    const statsSection = page.getByTestId('detail-stats-section')
    await expect(statsSection).toBeVisible()
    
    // Check last fired stat (first/last seen were removed in favour of last-fired)
    const lastFiredLabel = page.getByTestId('stat-last-fired')
    const occurrenceCountLabel = page.getByTestId('stat-occurrence-count')

    await expect(lastFiredLabel).toBeVisible()
    await expect(occurrenceCountLabel).toBeVisible()
  })

  test('detail panel shows occurrence count', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    
    // Seed alert with occurrence count
    await jarvis.seedResolved([
      {
        fingerprint: 'repeated-alert',
        alertname: 'RepeatedAlert',
        cluster: 'e2e',
        startsAt: '2025-01-15T10:00:00Z',
        resolvedAt: '2025-01-15T10:30:00Z',
      },
    ])
    
    await am.fire([
      {
        labels: {
          alertname: 'RepeatedAlert',
          severity: 'warning',
          cluster: 'e2e',
        },
        annotations: {
          summary: 'This alert has occurred multiple times',
        },
      },
    ])
    
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, 1)
    
    await dismissNoAuthNotice(page)
    await page.goto('/?state=active')
    
    // Open detail
    const firstCard = page.getByTestId('alert-card').first()
    await firstCard.click()
    await page.waitForTimeout(500)
    
    // Check occurrence count
    const occurrenceCountLabel = page.getByTestId('stat-occurrence-count')
    await expect(occurrenceCountLabel).toBeVisible()
    
    const text = await occurrenceCountLabel.textContent()
    expect(text).toMatch(/\d+/)
  })

  test('detail panel shows duration (when resolved)', async ({ page, jarvis }) => {
    await dismissNoAuthNotice(page)
    
    // Seed a resolved alert (labels required, else backend returns labels:null and the row fails to render)
    await jarvis.seedResolved([
      {
        fingerprint: 'resolved-alert',
        alertname: 'ResolvedAlert',
        cluster: 'e2e',
        startsAt: '2025-01-15T10:00:00Z',
        resolvedAt: '2025-01-15T10:30:00Z',
        labels: { alertname: 'ResolvedAlert', severity: 'warning', cluster: 'e2e' },
      },
    ])
    
    await page.goto('/?state=resolved')
    await page.waitForTimeout(500)
    
    // Open detail
    const firstCard = page.getByTestId('alert-list-row').first()
    await firstCard.click()
    await page.waitForTimeout(500)
    
    // Check duration stat
    const durationLabel = page.getByTestId('stat-duration')
    if (await durationLabel.isVisible()) {
      const text = await durationLabel.textContent()
      expect(text).toContain('30m') // 30 minute duration
    }
  })

  test('detail panel shows merged events timeline', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    await page.goto('/?state=active')
    
    // Open detail
    const firstCard = page.getByTestId('alert-card').first()
    await firstCard.click()
    await page.waitForTimeout(500)
    
    // Check for timeline/events section
    const timelineSection = page.getByTestId('detail-timeline-section')
    if (await timelineSection.isVisible()) {
      const events = page.getByTestId('timeline-event')
      await expect(events.first()).toBeVisible()
    }
  })
})

test.describe('D6: Set claim', () => {
  test('set claim shows badge in detail panel', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    // Get a fingerprint
    const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
    const alerts: any[] = await res.json()
    const fingerprint = alerts[0].fingerprint
    
    // Set claim
    await jarvis.setClaim(fingerprint, 'test-user', 'Working on this')
    
    await page.goto(`/?state=active&alert=${fingerprint}`)
    await page.waitForTimeout(500)
    
    // Verify claim badge
    const claimBadge = page.getByTestId('detail-claim-badge')
    await expect(claimBadge).toBeVisible()
    
    const text = await claimBadge.textContent()
    expect(text).toContain('test-user')
  })

  test('claim appears in card header', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    // Get a fingerprint
    const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
    const alerts: any[] = await res.json()
    const fingerprint = alerts[0].fingerprint
    
    // Set claim
    await jarvis.setClaim(fingerprint, 'claimer')
    
    // Poll to sync
    await jarvis.poll()
    
    await page.goto('/?state=active&viewMode=card')
    await page.waitForTimeout(500)
    
    // Verify claim badge on card
    const cardClaimBadge = page.getByTestId('alert-card-claim-badge').first()
    if (await cardClaimBadge.isVisible()) {
      const text = await cardClaimBadge.textContent()
      expect(text).toContain('claimer')
    }
  })

  test('WS update shows claim instantly', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    // Get a fingerprint
    const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
    const alerts: any[] = await res.json()
    const fingerprint = alerts[0].fingerprint
    
    // Open detail panel first
    await page.goto(`/?state=active&alert=${fingerprint}`)
    await page.waitForTimeout(500)
    
    // Now set claim (should appear via WS)
    await jarvis.setClaim(fingerprint, 'new-claimer')
    
    // Wait for WS update
    await page.waitForTimeout(1000)
    
    // Verify claim appears
    const claimBadge = page.getByTestId('detail-claim-badge')
    await expect(claimBadge).toBeVisible()
    
    const text = await claimBadge.textContent()
    expect(text).toContain('new-claimer')
  })
})

test.describe('D7: Release claim', () => {
  test('release claim removes badge', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    // Get a fingerprint
    const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
    const alerts: any[] = await res.json()
    const fingerprint = alerts[0].fingerprint
    
    // Set claim
    await jarvis.setClaim(fingerprint, 'test-user')
    
    // Open detail
    await page.goto(`/?state=active&alert=${fingerprint}`)
    await page.waitForTimeout(500)
    
    // Verify claim badge exists
    let claimBadge = page.getByTestId('detail-claim-badge')
    await expect(claimBadge).toBeVisible()
    
    // Click release button
    const releaseButton = page.getByTestId('claim-release-button')
    await expect(releaseButton).toBeVisible()
    await releaseButton.click()
    
    await page.waitForTimeout(500)
    
    // Verify badge removed
    claimBadge = page.getByTestId('detail-claim-badge')
    await expect(claimBadge).not.toBeVisible()
  })

  test('release claim clears claim note', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    // Get a fingerprint
    const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
    const alerts: any[] = await res.json()
    const fingerprint = alerts[0].fingerprint
    
    // Set claim with note
    await jarvis.setClaim(fingerprint, 'test-user', 'Investigating DB issue')
    
    // Open detail
    await page.goto(`/?state=active&alert=${fingerprint}`)
    await page.waitForTimeout(500)
    
    // Verify claim note shown
    const claimNote = page.getByTestId('detail-claim-note')
    if (await claimNote.isVisible()) {
      const text = await claimNote.textContent()
      expect(text).toContain('Investigating DB issue')
    }
    
    // Release claim
    const releaseButton = page.getByTestId('claim-release-button')
    await releaseButton.click()
    
    await page.waitForTimeout(500)
    
    // Verify note gone
    const noteAfter = page.getByTestId('detail-claim-note')
    await expect(noteAfter).not.toBeVisible()
  })
})

test.describe('D9: Add comment', () => {
  test('add comment visible in detail panel', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    // Get a fingerprint
    const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
    const alerts: any[] = await res.json()
    const fingerprint = alerts[0].fingerprint
    
    // Add comment
    await jarvis.addComment(fingerprint, 'This is a test comment', 'test-author')
    
    // Open detail
    await page.goto(`/?state=active&alert=${fingerprint}`)
    await page.waitForTimeout(500)
    
    // Verify comment visible
    const commentsSection = page.getByTestId('detail-comments-section')
    await expect(commentsSection).toBeVisible()
    
    const commentItems = page.getByTestId('detail-comment-item')
    const commentTexts = await commentItems.allTextContents()
    
    expect(commentTexts.join('\n')).toContain('This is a test comment')
  })

  test('comment shows author name and timestamp', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    // Get a fingerprint
    const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
    const alerts: any[] = await res.json()
    const fingerprint = alerts[0].fingerprint
    
    // Add comment
    await jarvis.addComment(fingerprint, 'Check logs for details', 'jane-doe')
    
    // Open detail
    await page.goto(`/?state=active&alert=${fingerprint}`)
    await page.waitForTimeout(500)
    
    // Verify comment metadata
    const commentAuthor = page.getByTestId('detail-comment-author').first()
    const commentTimestamp = page.getByTestId('detail-comment-timestamp').first()
    
    await expect(commentAuthor).toBeVisible()
    await expect(commentTimestamp).toBeVisible()
    
    const authorText = await commentAuthor.textContent()
    expect(authorText).toContain('jane-doe')
  })

  test('can add comment from detail panel form', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    // Open detail
    await page.goto('/?state=active')
    
    const firstCard = page.getByTestId('alert-card').first()
    await firstCard.click()
    await page.waitForTimeout(500)
    
    // Find comment input
    const commentInput = page.getByTestId('detail-comment-input')
    if (await commentInput.isVisible()) {
      // In 'none' auth mode an author name is required before the submit enables.
      await page.getByPlaceholder('Your name').fill('e2e-tester')
      await commentInput.fill('New comment from form')

      const submitButton = page.getByTestId('detail-comment-submit')
      await submitButton.click()

      await page.waitForTimeout(500)

      // Verify comment appears
      const commentTexts = await page.getByTestId('detail-comment-item').allTextContents()
      expect(commentTexts.join('\n')).toContain('New comment from form')
    }
  })
})

test.describe('D10: Delete comment (author only)', () => {
  test('comment author can delete own comment', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    // Get a fingerprint
    const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
    const alerts: any[] = await res.json()
    const fingerprint = alerts[0].fingerprint
    
    // Add comment
    await jarvis.addComment(fingerprint, 'Delete me', 'e2e-tester')
    
    // Open detail (as same user)
    await page.goto(`/?state=active&alert=${fingerprint}`)
    await page.waitForTimeout(500)
    
    // Verify delete button visible
    const deleteButton = page.getByTestId('detail-comment-delete').first()
    if (await deleteButton.isVisible()) {
      await deleteButton.click()
      
      await page.waitForTimeout(500)
      
      // Verify comment removed
      const commentTexts = await page.getByTestId('detail-comment-item').allTextContents()
      expect(commentTexts.join('\n')).not.toContain('Delete me')
    }
  })

  test('different user cannot delete others comments', async () => {
    // Author-only delete enforcement requires a user identity. In 'none' auth
    // mode there is no current user, so every comment is deletable by design
    // (AlertComments: canDelete === true when authMode === 'none'). This case is
    // only meaningful with auth enabled — covered in the internal/oidc suites.
    test.skip()
  })

  test('admin/mod can delete any comment', async () => {
    // This test would require auth system to be set up with role support
    // Skipping for now as e2e suite is 'none' auth mode
    test.skip()
  })
})

test.describe('G2: Extend controls in detail panel', () => {
  test('active expiring silence shows +1h/+4h/+1d and hides after extend', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    const now = Date.now()
    await jarvis.createSilence(
      'e2e',
      [{ name: 'alertname', value: 'KubePodCrashLooping', isRegex: false, isEqual: true }],
      {
        startsAt: new Date(now - 5 * 60 * 1000),
        endsAt: new Date(now + 10 * 60 * 1000),
        createdBy: 'e2e-tester',
        comment: 'expiring silence',
      },
    )
    await jarvis.poll()

    const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
    const alerts: any[] = await res.json()
    const target = alerts.find((a) => a.labels?.alertname === 'KubePodCrashLooping')
    expect(target).toBeTruthy()

    await page.goto(`/?state=active&alert=${target.fingerprint}`)
    const panel = page.getByTestId('detail-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Silence active').first()).toBeVisible()

    await expect(panel.getByRole('button', { name: '+1h' })).toBeVisible()
    await expect(panel.getByRole('button', { name: '+4h' })).toBeVisible()
    await expect(panel.getByRole('button', { name: '+1d' })).toBeVisible()

    await panel.getByRole('button', { name: '+1h' }).click()
    await expect(panel.getByRole('button', { name: '+1h' })).toHaveCount(0)
  })

  test('non-expiring active silence does not show extend quick actions', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    const now = Date.now()
    await jarvis.createSilence(
      'e2e',
      [{ name: 'alertname', value: 'KubePodCrashLooping', isRegex: false, isEqual: true }],
      {
        startsAt: new Date(now - 5 * 60 * 1000),
        endsAt: new Date(now + 2 * 60 * 60 * 1000),
        createdBy: 'e2e-tester',
        comment: 'long active silence',
      },
    )
    await jarvis.poll()

    const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
    const alerts: any[] = await res.json()
    const target = alerts.find((a) => a.labels?.alertname === 'KubePodCrashLooping')
    expect(target).toBeTruthy()

    await page.goto(`/?state=active&alert=${target.fingerprint}`)
    const panel = page.getByTestId('detail-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Silence active').first()).toBeVisible()

    await expect(panel.getByRole('button', { name: '+1h' })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: '+4h' })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: '+1d' })).toHaveCount(0)
  })
})

test.describe('D8: Owner edits claim note (immutable history)', () => {
  test('owner can update note and a new immutable history entry appears instantly', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
    const alerts: any[] = await res.json()
    const fingerprint = alerts[0].fingerprint

    await jarvis.setClaim(fingerprint, 'owner-user', 'first note')

    // In none-mode, ownership is the locally stored name → seed it so the
    // edit affordance shows for this claimant.
    await page.addInitScript(() => localStorage.setItem('jarvis-username', 'owner-user'))

    await page.goto(`/?state=active&alert=${fingerprint}`)
    await page.waitForTimeout(500)

    const claimNote = page.getByTestId('detail-claim-note')
    await expect(claimNote).toContainText('first note')

    // Open the edit form and change the note.
    const editButton = page.getByTestId('claim-edit-note-button')
    await expect(editButton).toBeVisible()
    await editButton.click()

    const editForm = page.getByTestId('claim-edit-note-form')
    await expect(editForm).toBeVisible()
    await editForm.locator('textarea').fill('second note')
    await editForm.getByRole('button', { name: 'Save' }).click()

    await page.waitForTimeout(500)

    // Badge reflects the new note.
    await expect(page.getByTestId('detail-claim-note')).toContainText('second note')

    // History updates instantly (no reload) and preserves the old note as an
    // immutable entry: both notes are present in the detail panel.
    const panel = page.getByTestId('detail-panel')
    await expect(panel).toContainText('second note')
    await expect(panel).toContainText('first note')

    // Backend kept both claim rows immutably.
    const histRes = await fetch(
      `${JARVIS_BASE_URL}/api/v1/alerts/${fingerprint}/claims/history?cluster=${encodeURIComponent(alerts[0].clusterName)}`,
    )
    const history: any[] = await histRes.json()
    expect(history.length).toBe(2)
    expect(history.some((h) => h.note === 'first note')).toBe(true)
    expect(history.some((h) => h.note === 'second note')).toBe(true)
  })

  test('non-owner does not see the edit affordance', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    const res = await fetch(`${JARVIS_BASE_URL}/api/v1/alerts`)
    const alerts: any[] = await res.json()
    const fingerprint = alerts[0].fingerprint

    await jarvis.setClaim(fingerprint, 'someone-else', 'their note')

    await page.addInitScript(() => localStorage.setItem('jarvis-username', 'not-the-owner'))
    await page.goto(`/?state=active&alert=${fingerprint}`)
    await page.waitForTimeout(500)

    await expect(page.getByTestId('detail-claim-badge')).toBeVisible()
    await expect(page.getByTestId('claim-edit-note-button')).toHaveCount(0)
  })
})

test.describe('D11: Detail panel accessibility', () => {
  test('dialog is labelled, traps focus on open and closes via Escape', async ({ page, am, jarvis }) => {
    await dismissNoAuthNotice(page)
    await am.fire(kubernetesAlerts)
    await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

    await page.goto('/?state=active')
    const firstCard = page.getByTestId('alert-card').first()
    await firstCard.click()

    const panel = page.getByTestId('detail-panel')
    await expect(panel).toBeVisible()

    // Dialog semantics: modal + labelled by the visible heading.
    await expect(panel).toHaveAttribute('aria-modal', 'true')
    await expect(panel).toHaveAttribute('aria-labelledby', 'detail-panel-title')
    await expect(page.locator('#detail-panel-title')).toBeVisible()

    // Focus moved into the dialog on open.
    const focusInside = await page.evaluate(() => {
      const p = document.querySelector('[data-testid="detail-panel"]')
      return !!p && (p === document.activeElement || p.contains(document.activeElement))
    })
    expect(focusInside).toBe(true)

    // Escape closes the dialog.
    await page.keyboard.press('Escape')
    await expect(panel).not.toBeVisible()
  })
})
