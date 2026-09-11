import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LabelMatcherOperator } from '@/types'

export interface DefaultFilter {
  name: string
  operator: LabelMatcherOperator
  value: string
}

export const CARD_COLUMN_OPTIONS = [1, 2, 3, 4, 5, 6] as const
export type CardColumns = 'auto' | (typeof CARD_COLUMN_OPTIONS)[number]

export interface UserSettings {
  // Display
  theme: 'dark' | 'light'
  timeFormat: 'relative' | 'absolute'
  defaultViewMode: 'card' | 'list'
  groupByLabel: string
  // Card view column count. 'auto' keeps the responsive 1/2/3/4 breakpoint
  // behavior; a fixed number overrides it regardless of window width.
  cardColumns: CardColumns

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
  cardColumns: 'auto',
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
