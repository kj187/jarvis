import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LabelMatcher } from '@/types'
import { useSettingsStore } from '@/store/useSettingsStore'

export type ViewMode = 'card' | 'list'
export type ActivePage = 'alerts' | 'silences'

export const DETAIL_TABS = ['details', 'history', 'comments', 'related', 'ai-prompt'] as const
export type DetailTab = (typeof DETAIL_TABS)[number]

export function isDetailTab(v: string | null | undefined): v is DetailTab {
  return DETAIL_TABS.includes(v as DetailTab)
}

interface Filters {
  state: string
  search: string
  labelMatchers: LabelMatcher[]
}

interface AlertCounts {
  filtered: number
  total: number
  byState: { active: number; suppressed: number; resolved: number }
  silenceCount: number
}

interface UIStore {
  viewMode: ViewMode
  activeViewMode: ViewMode
  activePage: ActivePage
  selectedFingerprint: string | null
  /**
   * Selection keys of the sibling alerts in the same alert-list group as
   * `selectedFingerprint` (list/card grouped views only), in display order.
   * Null when the current selection didn't come from a multi-alert group —
   * drives the group-navigation arrows in AlertDetailPanel.
   */
  selectedGroupKeys: string[] | null
  /** Active tab of the alert detail panel — synced to the `tab` URL param so reload/share lands on it. */
  detailTab: DetailTab
  filters: Filters
  wsConnected: boolean
  alertCounts: AlertCounts

  silencesViewMode: ViewMode
  isFullscreen: boolean

  // Actions
  setViewMode: (mode: ViewMode) => void
  setActivePage: (page: ActivePage) => void
  setActiveViewMode: (mode: ViewMode) => void
  setSilencesViewMode: (mode: ViewMode) => void
  setIsFullscreen: (v: boolean) => void
  setSelectedFingerprint: (fp: string | null, groupKeys?: string[] | null) => void
  setDetailTab: (tab: DetailTab) => void
  setFilter: (key: keyof Omit<Filters, 'labelMatchers'>, value: string) => void
  addLabelMatcher: (matcher: Omit<LabelMatcher, 'id'>) => void
  updateLabelMatcher: (id: string, partial: Partial<LabelMatcher>) => void
  removeLabelMatcher: (id: string) => void
  clearLabelMatchers: () => void
  resetFilters: () => void
  /** Replaces all locked matchers with the given defaults. Non-locked matchers are preserved. */
  syncLockedMatchers: (defaults: Omit<LabelMatcher, 'id' | 'locked'>[]) => void
  setWsConnected: (connected: boolean) => void
  setAlertCounts: (counts: AlertCounts) => void
}

const defaultFilters: Filters = {
  state: 'active',
  search: '',
  labelMatchers: [],
}

export const VIEW_MODE_KEY = 'jarvis-viewMode'
export const ACTIVE_VIEW_MODE_KEY = 'jarvis-activeViewMode'
export const SILENCES_VIEW_MODE_KEY = 'jarvis-silencesViewMode'

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

function loadSilencesViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(SILENCES_VIEW_MODE_KEY)
    if (v === 'list' || v === 'card') return v
  } catch { /* ignore */ }
  return 'card'
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
      silencesViewMode: loadSilencesViewMode(),
      isFullscreen: false,
      activePage: 'alerts',
      selectedFingerprint: null,
      selectedGroupKeys: null,
      detailTab: 'details',
      filters: defaultFilters,
      wsConnected: false,
      alertCounts: { filtered: 0, total: 0, byState: { active: 0, suppressed: 0, resolved: 0 }, silenceCount: 0 },

      setViewMode: (mode) => {
        try { localStorage.setItem(VIEW_MODE_KEY, mode) } catch { /* ignore */ }
        set({ viewMode: mode })
      },
      setActiveViewMode: (mode) => {
        try { localStorage.setItem(ACTIVE_VIEW_MODE_KEY, mode) } catch { /* ignore */ }
        set({ activeViewMode: mode })
      },
      setSilencesViewMode: (mode) => {
        try { localStorage.setItem(SILENCES_VIEW_MODE_KEY, mode) } catch { /* ignore */ }
        set({ silencesViewMode: mode })
      },
      setIsFullscreen: (v) => set({ isFullscreen: v }),
      setActivePage: (page) => set({ activePage: page, selectedFingerprint: null, selectedGroupKeys: null, detailTab: 'details' }),
      // Selecting a different alert (or closing the panel) resets the tab —
      // URL hydration relies on this order: setSelectedFingerprint first,
      // setDetailTab afterwards. groupKeys defaults to null so selections
      // outside a group context (card grid, related-tab jumps) drop any
      // stale group-navigation state from a previous selection.
      setSelectedFingerprint: (fp, groupKeys = null) => set({ selectedFingerprint: fp, selectedGroupKeys: groupKeys, detailTab: 'details' }),
      setDetailTab: (tab) => set({ detailTab: tab }),
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
      setAlertCounts: (counts) => set({ alertCounts: counts }),
    }),
    {
      name: 'jarvis-ui',
      partialize: (s) => ({
        activePage: s.activePage,
        filters: {
          ...s.filters,
          // Locked matchers are derived from Settings on every mount — never persist them.
          labelMatchers: s.filters.labelMatchers.filter((m) => !m.locked),
        },
      }),
    },
  ),
)
