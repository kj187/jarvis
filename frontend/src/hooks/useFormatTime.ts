import { useCallback } from 'react'
import { useSettingsStore } from '@/store/useSettingsStore'
import { formatTime } from '@/lib/alertUtils'

/**
 * Returns a stable formatTime function bound to the user's current timeFormat setting.
 * Re-renders callers automatically when the setting changes.
 */
export function useFormatTime(): (date: Date | string) => string {
  const timeFormat = useSettingsStore((s) => s.timeFormat)
  return useCallback((date: Date | string) => formatTime(date, timeFormat), [timeFormat])
}
