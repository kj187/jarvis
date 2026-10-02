// Mirrors the server's ping period (backend/internal/ws/hub.go defaultPingPeriod):
// the server sends a `heartbeat` message that often, because browsers hide ping
// frames from JavaScript.
export const WS_HEARTBEAT_INTERVAL_MS = 54_000
// Two missed heartbeats plus a little slack for network jitter.
export const WS_WATCHDOG_TIMEOUT_MS = 2 * WS_HEARTBEAT_INTERVAL_MS + 6_000

export interface Watchdog {
  kick: () => void
  stop: () => void
}

/** Calls onExpire when `timeoutMs` pass without a kick; stop() disarms it for good. */
export function createWatchdog(timeoutMs: number, onExpire: () => void): Watchdog {
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  return {
    kick() {
      stop()
      timer = setTimeout(() => {
        timer = undefined
        onExpire()
      }, timeoutMs)
    },
    stop,
  }
}
