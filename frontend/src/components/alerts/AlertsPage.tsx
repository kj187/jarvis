import { useEffect, useMemo, useRef } from 'react'
import { useAlerts } from '@/hooks/useAlerts'
import { useSilences } from '@/hooks/useSilences'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useUIStore } from '@/store/uiStore'
import { AlertCardGrid } from './AlertCardGrid'
import { AlertListView } from './AlertListView'
import { AlertDetailPanel } from './AlertDetailPanel'
import { matchesLabelMatchers, getEffectiveAlertState } from '@/lib/alertUtils'
import type { EnrichedAlert } from '@/types'

// URL state sync
function useURLState() {
  const {
    viewMode,
    filters,
    selectedFingerprint,
    setFilter,
    setSelectedFingerprint,
    clearLabelMatchers,
    addLabelMatcher,
  } = useUIStore()
  const hasHydrated = useRef(false)

  // Hydrate from URL on first mount
  useEffect(() => {
    if (hasHydrated.current) return
    hasHydrated.current = true
    const params = new URLSearchParams(window.location.search)
    setFilter('state', params.get('state') ?? 'active')
    const q = params.get('q')
    if (q) setFilter('search', q)
    const alert = params.get('alert')
    if (alert) setSelectedFingerprint(alert)
    const matchersRaw = params.get('matchers')
    if (matchersRaw) {
      try {
        const matchers = JSON.parse(matchersRaw)
        if (Array.isArray(matchers)) {
          clearLabelMatchers()
          matchers.forEach((m) => addLabelMatcher(m))
        }
      } catch { /* ignore */ }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Write URL on changes
  useEffect(() => {
    const params = new URLSearchParams()
    if (filters.state) params.set('state', filters.state)
    if (filters.search) params.set('q', filters.search)
    if (filters.labelMatchers.length > 0) {
      params.set('matchers', JSON.stringify(filters.labelMatchers.map(
        ({ name, operator, value }) => ({ name, operator, value }),
      )))
    }
    if (selectedFingerprint) params.set('alert', selectedFingerprint)
    const qs = params.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }, [viewMode, filters, selectedFingerprint])
}

export function AlertsPage() {
  useWebSocket()
  useURLState()

  const isResolvedMode = useUIStore((s) => s.filters.state === 'resolved')

  // Active/suppressed alerts come from the in-memory store via WS-patched cache.
  // Resolved alerts are queried directly from the DB so they persist indefinitely.
  const { data: liveAlerts = [], isLoading: liveLoading } = useAlerts()
  const { data: resolvedAlerts = [], isLoading: resolvedLoading } = useAlerts({ state: 'resolved' })
  const alerts = isResolvedMode ? resolvedAlerts : liveAlerts
  const isLoading = isResolvedMode ? resolvedLoading : liveLoading

  const { data: silences = [] } = useSilences()

  const {
    viewMode,
    filters,
    selectedFingerprint,
    setSelectedFingerprint,
    addLabelMatcher,
    setAlertCounts,
  } = useUIStore()

  // Filter alerts
  const filtered: EnrichedAlert[] = alerts.filter((alert) => {
    // Search filter
    if (filters.search) {
      const needle = filters.search.toLowerCase()
      const haystack = (alert.labels['alertname'] ?? '') + JSON.stringify(alert.labels)
      if (!haystack.toLowerCase().includes(needle)) return false
    }

    // State filter — skip for resolved mode (DB already returns only resolved)
    if (filters.state && !isResolvedMode) {
      const effectiveState = getEffectiveAlertState(alert, silences)
      if (effectiveState !== filters.state) return false
    }

    // Label matcher filter
    if (!matchesLabelMatchers(alert, filters.labelMatchers)) return false

    return true
  })

  const selectedAlert = selectedFingerprint
    ? filtered.find((a) => a.fingerprint === selectedFingerprint) ??
      alerts.find((a) => a.fingerprint === selectedFingerprint) ??
      null
    : null

  const byState = useMemo(() => {
    const counts = { active: 0, suppressed: 0, resolved: 0 }
    liveAlerts.forEach((alert) => {
      // Apply search + label matchers so tab counts match the visible filtered list.
      // State filter is intentionally excluded so all tabs show their own counts.
      if (filters.search) {
        const needle = filters.search.toLowerCase()
        const haystack = (alert.labels['alertname'] ?? '') + JSON.stringify(alert.labels)
        if (!haystack.toLowerCase().includes(needle)) return
      }
      if (!matchesLabelMatchers(alert, filters.labelMatchers)) return
      const s = getEffectiveAlertState(alert, silences)
      if (s in counts) counts[s as keyof typeof counts]++
    })
    // Resolved count comes from the DB-backed query, not the short-lived memory buffer.
    counts.resolved = resolvedAlerts.length
    return counts
  }, [liveAlerts, resolvedAlerts.length, silences, filters.search, filters.labelMatchers])

  // Keep header alert counts in sync — use primitive count values as deps
  // to avoid re-triggering when byState object reference changes on re-render
  useEffect(() => {
    setAlertCounts({ filtered: filtered.length, total: alerts.length, byState })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.length, alerts.length, byState.active, byState.suppressed, byState.resolved, setAlertCounts])

  return (
    <div className="flex flex-col gap-4">
      {/* Content */}
      {isLoading ? (
        <div className="px-4 text-sm text-muted-foreground">Loading…</div>
      ) : viewMode === 'card' && filters.state !== 'resolved' && filters.state !== 'suppressed' ? (
        <div className="px-4">
          <AlertCardGrid
            alerts={filtered}
            silences={silences}
            onSelectAlert={setSelectedFingerprint}
            selectedFingerprint={selectedFingerprint}
          />
        </div>
      ) : (
        <div className="px-4">
          <AlertListView
            alerts={filtered}
            silences={silences}
            onSelectAlert={setSelectedFingerprint}
            selectedFingerprint={selectedFingerprint}
            stateFilter={filters.state}
            resolvedMode={filters.state === 'resolved'}
          />
        </div>
      )}

      {/* Detail panel */}
      <AlertDetailPanel
        alert={selectedAlert}
        onClose={() => setSelectedFingerprint(null)}
        onAddLabelMatcher={addLabelMatcher}
        silences={silences}
      />
    </div>
  )
}
