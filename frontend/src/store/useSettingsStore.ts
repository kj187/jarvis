import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  resolveSettings,
  diffFromDefaults,
  DEFAULT_SETTINGS,
  CARD_COLUMN_OPTIONS,
  RESOLVED_PAGE_SIZE_OPTIONS,
  ALLOWED_SILENCE_DURATIONS,
} from '@/lib/settingsUtils'
import type { UserSettings, DefaultFilter, CardColumns, ResolvedPageSizeOption } from '@/lib/settingsUtils'

export {
  DEFAULT_SETTINGS,
  CARD_COLUMN_OPTIONS,
  RESOLVED_PAGE_SIZE_OPTIONS,
  ALLOWED_SILENCE_DURATIONS,
}
export type { UserSettings, DefaultFilter, CardColumns, ResolvedPageSizeOption }

export type SettingsWriteEvent =
  | { kind: 'update'; overrides: Partial<UserSettings> }
  | { kind: 'reset' }

// Set once by useSettingsSync (the only place that knows about fetch); the
// store itself never imports an API client (tmp/settings_storage.md §6.4).
let settingsWriter: ((event: SettingsWriteEvent) => void) | null = null

export function setSettingsWriter(writer: ((event: SettingsWriteEvent) => void) | null): void {
  settingsWriter = writer
}

function computeNextOverrides(
  currentOverrides: Partial<UserSettings>,
  globalDefaults: Partial<UserSettings>,
  partial: Partial<UserSettings>,
): Partial<UserSettings> {
  const next: Partial<UserSettings> = { ...currentOverrides }
  ;(Object.keys(partial) as (keyof UserSettings)[]).forEach((key) => {
    const value = partial[key]
    const withoutKey = { ...currentOverrides }
    delete withoutKey[key]
    const effectiveWithoutOverride = resolveSettings(globalDefaults, withoutKey)[key]
    // A value that exactly matches what's already effective without this
    // override is not an override — dropping it here means clicking a
    // setting back to its default doesn't permanently cement a redundant
    // entry (tmp/settings_storage.md §6.3).
    if (JSON.stringify(value) === JSON.stringify(effectiveWithoutOverride)) {
      delete next[key]
    } else {
      next[key] = value as never
    }
  })
  return next
}

interface SettingsStore extends UserSettings {
  /** Only what this user explicitly changed. Source of truth for persistence. */
  overrides: Partial<UserSettings>
  /** Instance-wide defaults from the server (Phase 3); {} until then. */
  globalDefaults: Partial<UserSettings>
  /** Storage backend currently in use — drives the SettingsSheet hint text. */
  origin: 'local' | 'server'
  /** Status of the last server write. */
  syncState: 'idle' | 'saving' | 'error'
  /** Internal — the device's anonymous overrides, kept even while a server
      identity is active, so logout can restore them without a request. */
  anonOverrides: Partial<UserSettings>
  /** Internal — mirror of the last known server row for the last known user
      (a read cache for instant hydration, never the source of truth). */
  userMirror: { id: string; overrides: Partial<UserSettings> } | null

  update: (partial: Partial<UserSettings>) => void
  reset: () => void
  /** Internal — used by useSettingsSync only. userId is required (and used
      to update the user mirror) whenever origin is 'server'. */
  applyRemote: (
    user: Partial<UserSettings> | null,
    global: Partial<UserSettings>,
    origin: 'local' | 'server',
    userId?: string,
  ) => void
  /** Internal — used by useSettingsSync only, to report a network write's outcome. */
  setSyncState: (state: 'idle' | 'saving' | 'error') => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,
      overrides: {},
      globalDefaults: {},
      origin: 'local',
      syncState: 'idle',
      anonOverrides: {},
      userMirror: null,

      update: (partial) => {
        const state = get()
        const nextOverrides = computeNextOverrides(state.overrides, state.globalDefaults, partial)
        const resolved = resolveSettings(state.globalDefaults, nextOverrides)
        const isLocal = state.origin === 'local'
        set({
          ...resolved,
          overrides: nextOverrides,
          anonOverrides: isLocal ? nextOverrides : state.anonOverrides,
          userMirror:
            !isLocal && state.userMirror
              ? { id: state.userMirror.id, overrides: nextOverrides }
              : state.userMirror,
        })
        if (!isLocal) settingsWriter?.({ kind: 'update', overrides: nextOverrides })
      },

      reset: () => {
        const state = get()
        const resolved = resolveSettings(state.globalDefaults, {})
        const isLocal = state.origin === 'local'
        set({
          ...resolved,
          overrides: {},
          anonOverrides: isLocal ? {} : state.anonOverrides,
          userMirror: !isLocal && state.userMirror ? { id: state.userMirror.id, overrides: {} } : state.userMirror,
        })
        if (!isLocal) settingsWriter?.({ kind: 'reset' })
      },

      applyRemote: (user, global, origin, userId) => {
        const overrides = user ?? {}
        const resolved = resolveSettings(global, overrides)
        set((state) => ({
          ...resolved,
          overrides,
          globalDefaults: global,
          origin,
          anonOverrides: origin === 'local' ? overrides : state.anonOverrides,
          userMirror: origin === 'server' && userId ? { id: userId, overrides } : state.userMirror,
          syncState: 'idle',
        }))
      },

      setSyncState: (syncState) => set({ syncState }),
    }),
    {
      // No `partialize` — the whole store state persists as before (zustand
      // silently drops the function-valued fields on JSON.stringify), so a
      // reload restores `anonOverrides`/`userMirror`/`origin` exactly as last
      // computed and — no less importantly — keeps the flat, top-level
      // `state.<key>` shape existing tooling (and the "none" mode E2E specs)
      // already reads directly from localStorage.
      name: 'jarvis-user-settings',
      version: 2,
      migrate: (persistedState, version) => {
        if (version < 2) {
          // Pre-v2 persisted the full resolved UserSettings blob directly at
          // the top level with no override/mirror bookkeeping at all; diff it
          // against the app defaults to get the sparse anon overrides.
          const anonOverrides = diffFromDefaults((persistedState ?? {}) as Partial<UserSettings>)
          return {
            ...resolveSettings({}, anonOverrides),
            overrides: anonOverrides,
            globalDefaults: {},
            origin: 'local',
            syncState: 'idle',
            anonOverrides,
            userMirror: null,
          }
        }
        return persistedState
      },
    },
  ),
)
