import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LabelMatcherOperator } from '@/types'

export interface DefaultFilter {
  name: string
  operator: LabelMatcherOperator
  value: string
}

export interface UserSettings {
  // Display
  theme: 'dark' | 'light'
  timeFormat: 'relative' | 'absolute'
  defaultViewMode: 'card' | 'list'

  // Default filter (locked, always present in header)
  defaultFilters: DefaultFilter[]

  // Resolved view
  resolvedPageSize: ResolvedPageSizeOption

  // Silences
  defaultSilenceDurationMinutes: number
  defaultCreatorName: string

  // Polling
  pollIntervalSeconds: number

  // Animations
  claimAnimationEnabled: boolean
}

export const POLL_OPTIONS = [5, 10, 15, 20, 25, 30, 60] as const
export type PollOption = (typeof POLL_OPTIONS)[number]

export const RESOLVED_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
export type ResolvedPageSizeOption = (typeof RESOLVED_PAGE_SIZE_OPTIONS)[number]

export const ALLOWED_SILENCE_DURATIONS = [15, 30, 60, 240, 480, 1440, 4320] as const

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  timeFormat: 'relative',
  defaultViewMode: 'card',
  defaultFilters: [],
  resolvedPageSize: 25,
  defaultSilenceDurationMinutes: 60,
  defaultCreatorName: '',
  pollIntervalSeconds: 15,
  claimAnimationEnabled: true,
}

interface SettingsStore extends UserSettings {
  update: (partial: Partial<UserSettings>) => void
  reset: () => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,

      update: (partial) => set((s) => ({ ...s, ...partial })),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: 'jarvis-user-settings',
    },
  ),
)

export function nearestPollOption(v: number): PollOption {
  return POLL_OPTIONS.reduce((best, opt) =>
    Math.abs(opt - v) < Math.abs(best - v) ? opt : best,
  )
}
