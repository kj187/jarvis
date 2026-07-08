// Pure bucketing logic for the alert firing-pattern heatmap. The backend
// returns raw firing-start timestamps (see backend/internal/api/alerts.go
// getAlertHeatmap); bucketing happens here so day/hour boundaries are
// computed in the browser's local timezone, not the server's.

export interface HeatmapCell {
  start: Date
  end: Date
  count: number
}

const HOUR_MS = 3_600_000

// 24h/7d cells are built as contiguous real-time (ms) windows ending at the
// current local hour. This is intentionally not calendar-aware: on a DST
// transition day the wall-clock hour label of a cell can shift by one, but
// every firing timestamp still lands in exactly one bucket (no gaps, no
// overlaps) since the windows are derived from a single anchor via plain ms
// arithmetic — total count is always preserved.
function bucketHourly(starts: Date[], now: Date, count: number): HeatmapCell[] {
  const currentHourStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
  ).getTime()

  const cells: HeatmapCell[] = Array.from({ length: count }, (_, j) => {
    const startMs = currentHourStart - (count - 1 - j) * HOUR_MS
    return { start: new Date(startMs), end: new Date(startMs + HOUR_MS), count: 0 }
  })

  for (const s of starts) {
    const sHourStart = new Date(s.getFullYear(), s.getMonth(), s.getDate(), s.getHours()).getTime()
    const i = Math.round((currentHourStart - sHourStart) / HOUR_MS)
    if (i >= 0 && i < count) cells[count - 1 - i].count++
  }
  return cells
}

// 30d cells are aligned to local calendar midnight (via setDate, which JS
// Date normalizes correctly across DST) so each cell represents one real
// calendar day, not a fixed 24h window. The most recent cell is "today"
// (midnight so far), matching the hourly ranges' current-bucket behavior.
function bucketDaily(starts: Date[], now: Date, count: number): HeatmapCell[] {
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const cells: HeatmapCell[] = Array.from({ length: count }, (_, j) => {
    const offset = count - 1 - j
    const start = new Date(todayMidnight)
    start.setDate(start.getDate() - offset)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return { start, end, count: 0 }
  })

  for (const s of starts) {
    const t = s.getTime()
    const idx = cells.findIndex((c) => t >= c.start.getTime() && t < c.end.getTime())
    if (idx !== -1) cells[idx].count++
  }
  return cells
}

export function bucketFiringStarts(
  startsIso: string[],
  range: '24h' | '7d' | '30d',
  now: Date = new Date(),
): HeatmapCell[] {
  const starts = startsIso.map((iso) => new Date(iso))
  if (range === '30d') return bucketDaily(starts, now, 30)
  return bucketHourly(starts, now, range === '24h' ? 24 : 168)
}
