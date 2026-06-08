import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LabelMatcher } from '@/types'

export type ViewMode = 'card' | 'list'

interface Filters {
  state: string
  search: string
  labelMatchers: LabelMatcher[]
}

interface AlertCounts {
  filtered: number
  total: number
}

interface UIStore {
  viewMode: ViewMode
  selectedFingerprint: string | null
  filters: Filters
  wsConnected: boolean
  pollingPaused: boolean
  alertCounts: AlertCounts

  // Actions
  setViewMode: (mode: ViewMode) => void
  setSelectedFingerprint: (fp: string | null) => void
  setFilter: (key: keyof Omit<Filters, 'labelMatchers'>, value: string) => void
  addLabelMatcher: (matcher: Omit<LabelMatcher, 'id'>) => void
  updateLabelMatcher: (id: string, partial: Partial<LabelMatcher>) => void
  removeLabelMatcher: (id: string) => void
  clearLabelMatchers: () => void
  resetFilters: () => void
  setWsConnected: (connected: boolean) => void
  setPollingPaused: (paused: boolean) => void
  setAlertCounts: (counts: AlertCounts) => void
}

const defaultFilters: Filters = {
  state: 'active',
  search: '',
  labelMatchers: [],
}

let _nextId = 1
function nextId(): string {
  return String(_nextId++)
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      viewMode: 'card',
      selectedFingerprint: null,
      filters: defaultFilters,
      wsConnected: false,
      pollingPaused: false,
      alertCounts: { filtered: 0, total: 0 },

      setViewMode: (mode) => set({ viewMode: mode }),
      setSelectedFingerprint: (fp) => set({ selectedFingerprint: fp }),
      setFilter: (key, value) =>
        set((s) => ({ filters: { ...s.filters, [key]: value } })),

      addLabelMatcher: (matcher) =>
        set((s) => ({
          filters: {
            ...s.filters,
            labelMatchers: [
              ...s.filters.labelMatchers,
              { ...matcher, id: nextId() },
            ],
          },
        })),

      updateLabelMatcher: (id, partial) =>
        set((s) => ({
          filters: {
            ...s.filters,
            labelMatchers: s.filters.labelMatchers.map((m) =>
              m.id === id ? { ...m, ...partial } : m,
            ),
          },
        })),

      removeLabelMatcher: (id) =>
        set((s) => ({
          filters: {
            ...s.filters,
            labelMatchers: s.filters.labelMatchers.filter((m) => m.id !== id),
          },
        })),

      clearLabelMatchers: () =>
        set((s) => ({ filters: { ...s.filters, labelMatchers: [] } })),

      resetFilters: () => set({ filters: defaultFilters }),

      setWsConnected: (connected) => set({ wsConnected: connected }),
      setPollingPaused: (paused) => set({ pollingPaused: paused }),
      setAlertCounts: (counts) => set({ alertCounts: counts }),
    }),
    {
      name: 'jarvis-ui',
      partialize: (s) => ({
        viewMode: s.viewMode,
        filters: s.filters,
      }),
    },
  ),
)
