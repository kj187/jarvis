import type { Page } from '@playwright/test'
import type { AlertmanagerClient, AlertInput } from './alertmanager'
import type { JarvisClient, SeedHeatmapHistoryAlert, FiringCycle } from './jarvis'
import { freezeClock, waitForActiveAlerts } from './fixtures'

interface LiveAlert {
  fingerprint: string
  clusterName: string
  alertmanagerUrl?: string
  labels: Record<string, string>
  annotations?: Record<string, string>
}

/** Deterministic PRNG (mulberry32) — same seed always produces the same
 *  sequence, so regenerating screenshots twice yields the same heatmap. */
function mulberry32(seed: number): () => number {
  let s = seed
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) h = (Math.imul(31, h) + input.charCodeAt(i)) | 0
  return h
}

interface Band {
  minHoursAgo: number
  maxHoursAgo: number
  minHits: number
  maxHits: number
}

/** Share of alerts that get a backfilled firing history at all. Real fleets
 *  are a mix of chronic recurring alerts and ones that just fired for the
 *  first time — giving every single alert a rich history reads as fake. */
const HISTORY_PROBABILITY = 0.55

/**
 * One band per range toggle (24h/7d/30d) with its own hit-count range, so
 * every alert's heatmap shows *some* pattern in every range without relying
 * on luck. Seeded per-fingerprint (mulberry32), so different alerts land
 * different hit counts/positions — no more identical-looking cards — while
 * the same alert (same labels → same real AM fingerprint) reproduces the
 * exact same pattern on every regeneration.
 */
const BANDS: Band[] = [
  { minHoursAgo: 0.3, maxHoursAgo: 20, minHits: 3, maxHits: 6 },
  { minHoursAgo: 24, maxHoursAgo: 160, minHits: 3, maxHits: 6 },
  { minHoursAgo: 165, maxHoursAgo: 700, minHits: 4, maxHits: 8 },
]

function buildCycles(rand: () => number, now: Date): FiringCycle[] {
  const cycles: FiringCycle[] = []
  for (const band of BANDS) {
    const hits = band.minHits + Math.floor(rand() * (band.maxHits - band.minHits + 1))
    let firstHoursAgo: number | null = null
    let lastHoursAgo: number | null = null
    for (let i = 0; i < hits; i++) {
      let hoursAgo: number
      if (i === 1 && firstHoursAgo !== null) {
        // Guarantee at least one repeat hit near the first cycle's bucket —
        // reliably produces a count > 1 cell every regeneration instead of
        // leaving contrast to chance, so cell intensity actually varies.
        hoursAgo = Math.max(band.minHoursAgo, firstHoursAgo + (rand() - 0.5) * 1.5)
      } else if (lastHoursAgo !== null && rand() < 0.4) {
        // Re-hit the same bucket (± small jitter) so some cells end up with
        // count > 1 — varying intensity instead of every filled cell reading
        // as "exactly one firing" at full color.
        hoursAgo = Math.max(band.minHoursAgo, lastHoursAgo + (rand() - 0.5) * 1.5)
      } else {
        hoursAgo = band.minHoursAgo + rand() * (band.maxHoursAgo - band.minHoursAgo)
      }
      if (i === 0) firstHoursAgo = hoursAgo
      lastHoursAgo = hoursAgo
      const startsAt = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000)
      const durationMin = 3 + rand() * 20
      const resolvedAt = new Date(startsAt.getTime() + durationMin * 60 * 1000)
      cycles.push({ startsAt: startsAt.toISOString(), resolvedAt: resolvedAt.toISOString() })
    }
  }
  return cycles
}

function buildHeatmapHistory(alert: LiveAlert, now: Date): SeedHeatmapHistoryAlert {
  const rand = mulberry32(hashSeed(alert.fingerprint))
  // First draw decides recurring-vs-first-time so it's stable across
  // regenerations regardless of how many random calls buildCycles makes.
  const hasHistory = rand() < HISTORY_PROBABILITY
  return {
    fingerprint: alert.fingerprint,
    alertname: alert.labels.alertname,
    cluster: alert.clusterName,
    alertmanagerUrl: alert.alertmanagerUrl,
    labels: alert.labels,
    annotations: alert.annotations,
    cycles: hasHistory ? buildCycles(rand, now) : [],
  }
}

/**
 * Fires alerts and backfills a multi-week firing history for each so their
 * heatmaps look like they've been in production for a while, not just this
 * test session. Screenshot-only helper — functional tests don't care what
 * the heatmap looks like.
 *
 * Fires normally (through the real poll path, so occurrence_count/claims/etc.
 * behave exactly like any other screenshot spec), then backfills historical
 * cycles on top of that already-live fingerprint via
 * `jarvis.seedHeatmapHistory` — direct inserts, not the production
 * RecordStatusChange/RecordResolvedForCluster path (see
 * SeedFiringHistoryForTesting's docstring for why chaining historical cycles
 * through that idempotency/grace-period logic silently collapses them into
 * one surviving row). Deliberately does **not** reset the DB in between:
 * an earlier version did, to start seeding from a clean fingerprint row, but
 * `jarvis.reset()` also truncates `users` — fatal for specs that log in
 * (`ensureInternalAdmin`/`loginOIDC`) before calling this helper. The direct
 * insert path doesn't need a clean slate anyway.
 *
 * Freezes the browser clock to the **real** current instant (not the fixed
 * 2025-01-15 screenshot epoch other specs use) — `bucketFiringStarts`
 * buckets relative to the frontend's `now`, while the backend's heatmap
 * window filter (`GetFiringStarts`) is always relative to real server time.
 * Freezing to the old fixed epoch made every seeded timestamp land outside
 * the frontend's bucket range, rendering an all-empty grid despite real data.
 * Don't call `freezeClock(page)` separately in specs using this helper.
 */
export async function fireWithHeatmapHistory(
  page: Page,
  am: AlertmanagerClient,
  jarvis: JarvisClient,
  baseURL: string,
  alerts: AlertInput[],
): Promise<void> {
  await freezeClock(page, new Date())
  await am.fire(alerts)
  await waitForActiveAlerts(jarvis, baseURL, alerts.length)

  const res = await fetch(`${baseURL}/api/v1/alerts`)
  const liveAlerts: LiveAlert[] = await res.json()

  const now = new Date()
  await jarvis.seedHeatmapHistory(liveAlerts.map((live) => buildHeatmapHistory(live, now)))
}

/**
 * For screenshots that specifically demo the heatmap (as opposed to just
 * wanting a populated-looking background), `fireWithHeatmapHistory` rolling
 * "no history" (`HISTORY_PROBABILITY`) for whichever alert the spec happens
 * to grab would defeat the point. This picks the first fired alert that
 * actually got a backfilled history — deterministic given the same fixture,
 * since the coin flip is seeded by fingerprint — falling back to the first
 * alert if none did (shouldn't happen with >= 2 alerts at 55% odds each).
 */
export async function pickAlertWithHistory(
  baseURL: string,
  alerts: Array<{ fingerprint: string; clusterName?: string }>,
): Promise<{ fingerprint: string }> {
  for (const alert of alerts) {
    const url = new URL(`${baseURL}/api/v1/alerts/${alert.fingerprint}/stats`)
    if (alert.clusterName) url.searchParams.set('cluster', alert.clusterName)
    const res = await fetch(url)
    if (!res.ok) continue
    const stats: { occurrenceCount: number } = await res.json()
    if (stats.occurrenceCount > 1) return alert
  }
  return alerts[0]
}
