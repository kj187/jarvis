import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { useSettingsStore, setSettingsWriter } from '@/store/useSettingsStore'
import type { SettingsWriteEvent } from '@/store/useSettingsStore'
import { fetchSettings, putSettings, deleteSettings } from '@/api/client'
import { normalizeSettings } from '@/lib/settingsUtils'

const WRITE_DEBOUNCE_MS = 300

/**
 * The single place that decides where settings live. The store itself never
 * imports an API client — it only exposes `applyRemote` (this hook's read
 * path) and `setSettingsWriter` (this hook's write path). Mounted once in App.tsx, next to useWebSocket/useAlertCounts.
 */
export function useSettingsSync(): void {
  const providerInfo = useAuthStore((s) => s.providerInfo)
  const user = useAuthStore((s) => s.user)
  const isLoading = useAuthStore((s) => s.isLoading)
  const applyRemote = useSettingsStore((s) => s.applyRemote)
  const setSyncState = useSettingsStore((s) => s.setSyncState)
  const queryClient = useQueryClient()

  const isServerMode = !isLoading && providerInfo != null && providerInfo.mode !== 'none' && user !== null
  const userId = isServerMode && user ? user.id : null

  // The instance defaults (`global`) are served to everyone, so local mode reads
  // them too — just without ever writing. full_protect without a session would
  // only get a 401, so it waits for the login (which flips to server mode).
  const isBlockedByLogin = providerInfo?.authMode === 'full_protect' && user === null
  const { data, error, isSuccess } = useQuery({
    queryKey: ['settings', userId],
    queryFn: fetchSettings,
    enabled: !isLoading && (isServerMode || !isBlockedByLogin),
    staleTime: Infinity,
    retry: 1,
  })

  // Local mode (no auth provider, or not logged in): the user's own settings
  // come from the anon mirror; only the instance defaults are fetched. A failed
  // fetch just means no instance defaults — the built-in ones apply.
  useEffect(() => {
    if (isLoading || isServerMode) return
    const anon = useSettingsStore.getState().anonOverrides
    const global = isSuccess && data ? normalizeSettings(data.global) : {}
    applyRemote(anon, global, 'local')
  }, [isLoading, isServerMode, isSuccess, data, applyRemote])

  // Server mode, fetch succeeded: adopt the anon slot once if the account has
  // no row yet, otherwise resolve the fetched blob.
  useEffect(() => {
    if (!isServerMode || !userId || !isSuccess || !data) return
    const global = normalizeSettings(data.global)
    if (data.user !== null) {
      applyRemote(normalizeSettings(data.user), global, 'server', userId)
      return
    }
    const anon = useSettingsStore.getState().anonOverrides
    if (Object.keys(anon).length > 0) {
      applyRemote(anon, global, 'server', userId)
      putSettings(anon)
        .then(() => queryClient.invalidateQueries({ queryKey: ['settings', userId] }))
        .catch(() => setSyncState('error'))
      return
    }
    applyRemote({}, global, 'server', userId)
  }, [isServerMode, userId, isSuccess, data, applyRemote, queryClient, setSyncState])

  // Server mode, fetch failed: fall back to this user's last-known mirror (if
  // any) and surface the failure via syncState.
  useEffect(() => {
    if (!isServerMode || !userId || !error) return
    const mirror = useSettingsStore.getState().userMirror
    const overrides = mirror?.id === userId ? mirror.overrides : {}
    applyRemote(overrides, {}, 'server', userId)
    setSyncState('error')
  }, [isServerMode, userId, error, applyRemote, setSyncState])

  // Writer: debounced PUT on every change, DELETE on reset. Optimistic — a
  // write failure never rolls the local state back.
  useEffect(() => {
    if (!isServerMode) {
      setSettingsWriter(null)
      return
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const writer = (event: SettingsWriteEvent) => {
      if (timer) clearTimeout(timer)
      if (event.kind === 'reset') {
        setSyncState('saving')
        deleteSettings()
          .then(() => setSyncState('idle'))
          .catch(() => setSyncState('error'))
        return
      }
      timer = setTimeout(() => {
        setSyncState('saving')
        putSettings(event.overrides)
          .then(() => setSyncState('idle'))
          .catch(() => setSyncState('error'))
      }, WRITE_DEBOUNCE_MS)
    }
    setSettingsWriter(writer)
    return () => {
      if (timer) clearTimeout(timer)
      setSettingsWriter(null)
    }
  }, [isServerMode, setSyncState])
}
