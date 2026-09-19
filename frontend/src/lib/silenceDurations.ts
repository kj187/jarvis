/** Longest configurable silence duration: one year (365 days). */
export const MAX_SILENCE_DURATION_MINUTES = 365 * 24 * 60

/** Most entries the silence-durations list may hold — keeps the Fast-Silence and Extend menus usable. */
export const MAX_SILENCE_DURATION_CHOICES = 12

/** Suffix → minutes. "y" is a flat 365 days; there is no month unit (30d says what it means). */
const UNIT_MINUTES = { m: 1, h: 60, d: 24 * 60, w: 7 * 24 * 60, y: MAX_SILENCE_DURATION_MINUTES } as const

/**
 * Parses one `<number><unit>` duration (`30m`, `4h`, `1d`, `1w`, `30d`, `1y`)
 * into minutes. Returns null for anything else — no combined units, decimals,
 * signs or values outside 1 minute … 365 days. Mirrors `ParseSilenceDurations`
 * in backend/internal/config/silence_durations.go (the JARVIS_SILENCE_DURATIONS
 * grammar); keep the two in sync.
 */
export function parseSilenceDuration(input: string): number | null {
  const match = /^(\d+)([mhdwy])$/.exec(input.trim())
  if (!match) return null
  const unit = UNIT_MINUTES[match[2] as keyof typeof UNIT_MINUTES]
  const amount = Number(match[1])
  if (amount < 1 || amount > MAX_SILENCE_DURATION_MINUTES / unit) return null
  return amount * unit
}

export function isValidSilenceDurationMinutes(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_SILENCE_DURATION_MINUTES
  )
}

/**
 * Cleans an unverified duration list (from the server or localStorage): keeps
 * valid minute values, sorted ascending and deduplicated, capped at
 * MAX_SILENCE_DURATION_CHOICES (the shortest ones win). May return [] — the
 * caller decides what an empty list means.
 */
export function normalizeSilenceDurations(raw: unknown[]): number[] {
  const valid = raw.filter(isValidSilenceDurationMinutes)
  return [...new Set(valid)].sort((a, b) => a - b).slice(0, MAX_SILENCE_DURATION_CHOICES)
}

/**
 * Button label for a duration: the largest unit that divides it exactly
 * (`1y`, `2w`, `30d`, `4h`), otherwise plain minutes (`90m`) — always text
 * that `parseSilenceDuration` reads back to the same value.
 */
export function formatDurationChoice(minutes: number): string {
  if (minutes > 0) {
    for (const [suffix, unit] of [['y', UNIT_MINUTES.y], ['w', UNIT_MINUTES.w], ['d', UNIT_MINUTES.d], ['h', UNIT_MINUTES.h]] as const) {
      if (minutes % unit === 0) return `${minutes / unit}${suffix}`
    }
  }
  return `${minutes}m`
}
