import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LabelMatcher } from '@/types'
import { useSettingsStore } from '@/store/useSettingsStore'

export type ViewMode = 'card' | 'list'

interface Filters {
  state: string
  search: string
  labelMatchers: LabelMatcher[]
}

interface AlertCounts {
  filtered: number
  total: number
  byState: { active: number; suppressed: number; resolved: number }
}

interface UIStore {
  viewMode: ViewMode
  activeViewMode: ViewMode
  selectedFingerprint: string | null
  filters: Filters
  wsConnected: boolean
  pollingPaused: boolean
  alertCounts: AlertCounts

  // Actions
  setViewMode: (mode: ViewMode) => void
  setActiveViewMode: (mode: ViewMode) => void
  setSelectedFingerprint: (fp: string | null) => void
  setFilter: (key: keyof Omit<Filters, 'labelMatchers'>, value: string) => void
  addLabelMatcher: (matcher: Omit<LabelMatcher, 'id'>) => void
  updateLabelMatcher: (id: string, partial: Partial<LabelMatcher>) => void
  removeLabelMatcher: (id: string) => void
  clearLabelMatchers: () => void
  resetFilters: () => void
  /** Replaces all locked matchers with the given defaults. Non-locked matchers are preserved. */
  syncLockedMatchers: (defaults: Omit<LabelMatcher, 'id' | 'locked'>[]) => void
  setWsConnected: (connected: boolean) => void
  setPollingPaused: (paused: boolean) => void
  setAlertCounts: (counts: AlertCounts) => void
}

const defaultFilters: Filters = {
  state: 'active',
  search: '',
  labelMatchers: [],
}

export const VIEW_MODE_KEY = 'jarvis-viewMode'
export const ACTIVE_VIEW_MODE_KEY = 'jarvis-activeViewMode'

function loadViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY)
    if (v === 'list' || v === 'card') return v
  } catch { /* ignore */ }
  return useSettingsStore.getState().defaultViewMode
}

function loadActiveViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(ACTIVE_VIEW_MODE_KEY)
    if (v === 'list' || v === 'card') return v
  } catch { /* ignore */ }
  return loadViewMode()
}

let _nextId = 1
function nextId(): string {
  return String(_nextId++)
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      viewMode: loadViewMode(),
      activeViewMode: loadActiveViewMode(),
      selectedFingerprint: null,
      filters: defaultFilters,
      wsConnected: false,
      pollingPaused: false,
      alertCounts: { filtered: 0, total: 0, byState: { active: 0, suppressed: 0, resolved: 0 } },

      setViewMode: (mode) => {
        try { localStorage.setItem(VIEW_MODE_KEY, mode) } catch { /* ignore */ }
        set({ viewMode: mode })
      },
      setActiveViewMode: (mode) => {
        try { localStorage.setItem(ACTIVE_VIEW_MODE_KEY, mode) } catch { /* ignore */ }
        set({ activeViewMode: mode })
      },
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
            // Never remove locked matchers from the header
            labelMatchers: s.filters.labelMatchers.filter((m) => m.id !== id || m.locked),
          },
        })),

      clearLabelMatchers: () =>
        set((s) => ({
          filters: {
            ...s.filters,
            labelMatchers: s.filters.labelMatchers.filter((m) => m.locked),
          },
        })),

      resetFilters: () =>
        set((s) => ({
          filters: {
            ...defaultFilters,
            labelMatchers: s.filters.labelMatchers.filter((m) => m.locked),
          },
        })),

      syncLockedMatchers: (defaults) =>
        set((s) => {
          // Build a set of keys for the incoming locked matchers so we can
          // drop any non-locked matchers that would become duplicates.
          const lockedKeys = new Set(
            defaults.map((d) => `${d.name}${d.operator}${d.value}`),
          )
          return {
            filters: {
              ...s.filters,
              labelMatchers: [
                ...defaults.map((d) => ({
                  ...d,
                  id: `locked:${d.name}${d.operator}${d.value}`,
                  locked: true as const,
                })),
                // Drop old locked matchers AND any unlocked duplicates
                ...s.filters.labelMatchers.filter(
                  (m) =>
                    !m.locked &&
                    !lockedKeys.has(`${m.name}${m.operator}${m.value}`),
                ),
              ],
            },
          }
        }),

      setWsConnected: (connected) => set({ wsConnected: connected }),
      setPollingPaused: (paused) => set({ pollingPaused: paused }),
      setAlertCounts: (counts) => set({ alertCounts: counts }),
    }),
    {
      name: 'jarvis-ui',
      partialize: (s) => ({
        filters: {
          ...s.filters,
          // Locked matchers are derived from Settings on every mount — never persist them.
          labelMatchers: s.filters.labelMatchers.filter((m) => !m.locked),
        },
      }),
    },
  ),
)
