import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWatchdog, WS_HEARTBEAT_INTERVAL_MS, WS_WATCHDOG_TIMEOUT_MS } from './wsHeartbeat'

describe('createWatchdog', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('waits two heartbeat intervals plus margin before giving up', () => {
    expect(WS_WATCHDOG_TIMEOUT_MS).toBeGreaterThan(2 * WS_HEARTBEAT_INTERVAL_MS)
  })

  it('fires when nothing arrives within the timeout', () => {
    const onExpire = vi.fn()
    const dog = createWatchdog(1000, onExpire)
    dog.kick()
    vi.advanceTimersByTime(999)
    expect(onExpire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('every kick restarts the countdown', () => {
    const onExpire = vi.fn()
    const dog = createWatchdog(1000, onExpire)
    dog.kick()
    vi.advanceTimersByTime(900)
    dog.kick()
    vi.advanceTimersByTime(900)
    expect(onExpire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('never fires after stop', () => {
    const onExpire = vi.fn()
    const dog = createWatchdog(1000, onExpire)
    dog.kick()
    dog.stop()
    vi.advanceTimersByTime(5000)
    expect(onExpire).not.toHaveBeenCalled()
  })
})
