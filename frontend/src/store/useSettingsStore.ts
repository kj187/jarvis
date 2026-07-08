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
  groupByLabel: string

  // Default filter (locked, always present in header)
  defaultFilters: DefaultFilter[]

  // Resolved view
  resolvedPageSize: ResolvedPageSizeOption

  // Silences
  defaultSilenceDurationMinutes: number
  defaultCreatorName: string

  // Animations
  claimAnimationEnabled: boolean
}

export const RESOLVED_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
export type ResolvedPageSizeOption = (typeof RESOLVED_PAGE_SIZE_OPTIONS)[number]

export const ALLOWED_SILENCE_DURATIONS = [15, 30, 60, 240, 480, 1440, 4320] as const

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  timeFormat: 'relative',
  defaultViewMode: 'card',
  groupByLabel: 'severity',
  defaultFilters: [],
  resolvedPageSize: 25,
  defaultSilenceDurationMinutes: 60,
  defaultCreatorName: '',
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
