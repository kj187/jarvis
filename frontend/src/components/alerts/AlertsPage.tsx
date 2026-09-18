import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChartPie, Loader2, Maximize2, Search, X, Siren, BellOff, CheckCircle2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ViewToggle } from './ViewToggle'
import { AlertsOverviewModal } from './AlertsOverviewModal'
import { MatcherChipsBar } from '@/components/layout/MatcherChipsBar'
import { SavedFiltersMenu } from './SavedFiltersMenu'
import { useAlerts } from '@/hooks/useAlerts'
import { useSilences } from '@/hooks/useSilences'
import { useUIStore, isDetailTab } from '@/store/uiStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { useAuthStore } from '@/store/authStore'
import { AlertCardGrid } from './AlertCardGrid'
import { GroupingControl } from './GroupingControl'
import { AlertListView } from './AlertListView'
import { AlertDetailPanel } from './AlertDetailPanel'
import { matchesAlertSearch, matchesLabelMatchers, getEffectiveAlertState } from '@/lib/alertUtils'
import { findDefaultSavedFilter, hasAlertViewParams } from '@/lib/savedFilters'
import { FILTER_PARAM, LEGACY_MATCHERS_PARAM, formatMatchers, readUrlMatchers } from '@/lib/filterUrl'
import { parseAlertSelectionKey } from '@/lib/alertSelection'
import type { EnrichedAlert } from '@/types'

const CARD_GROUPING_KEY = 'jarvis-alert-card-grouping-enabled'

function loadCardGroupingEnabled(): boolean {
  try {
    const stored = window.localStorage.getItem(CARD_GROUPING_KEY)
    if (stored === 'false') return false
  } catch {
    // ignore malformed local storage value
  }
  return true
}

// ── URL state sync ────────────────────────────────────────────────────────────

function useURLState() {
  const {
    viewMode,
    filters,
    selectedFingerprint,
    detailTab,
    setFilter,
    setSelectedFingerprint,
    setDetailTab,
    setLabelMatchers,
  } = useUIStore()
  const hasHydrated = useRef(false)

  // Hydrate from URL on first mount
  useEffect(() => {
    if (hasHydrated.current) return
    hasHydrated.current = true
    const search = window.location.search
    const params = new URLSearchParams(search)
    setFilter('state', params.get('state') ?? 'active')
    const q = params.get('q')
    if (q) setFilter('search', q)
    const alert = params.get('alert')
    if (alert) {
      setSelectedFingerprint(alert)
      // After setSelectedFingerprint — it resets detailTab to 'details'.
      const tab = params.get('tab')
      if (isDetailTab(tab)) setDetailTab(tab)
    }
    const urlMatchers = readUrlMatchers(params)
    if (urlMatchers) {
      setLabelMatchers(urlMatchers)
    } else if (!hasAlertViewParams(search)) {
      // No state/q/filter/alert in the URL at all — the URL is not
      // authoritative for anything, so apply the saved filter marked as
      // default, if any (replaces whatever localStorage restored).
      const def = findDefaultSavedFilter(useSettingsStore.getState().savedFilters)
      if (def) setLabelMatchers(def.matchers)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Write URL on changes
  useEffect(() => {
    // Preserve URL state owned by other shell components (for example the
    // Settings sheet) while replacing only the alert-page parameters.
    const params = new URLSearchParams(window.location.search)
    ;['state', 'q', FILTER_PARAM, LEGACY_MATCHERS_PARAM, 'alert', 'tab'].forEach((key) => params.delete(key))
    if (filters.state) params.set('state', filters.state)
    if (filters.search) params.set('q', filters.search)
    if (filters.labelMatchers.length > 0) {
      params.set(FILTER_PARAM, formatMatchers(filters.labelMatchers))
    }
    if (selectedFingerprint) {
      params.set('alert', selectedFingerprint)
      if (detailTab !== 'details') params.set('tab', detailTab)
    }
    const qs = params.toString()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`,
    )
  }, [viewMode, filters, selectedFingerprint, detailTab])
}

// ── AlertsPage ────────────────────────────────────────────────────────────────

export function AlertsPage() {
  useURLState()

  const providerInfo = useAuthStore((s) => s.providerInfo)
  const {
    viewMode,
    filters,
    selectedFingerprint,
    setSelectedFingerprint,
    addLabelMatcher,
    setFilter,
    setViewMode,
    activeViewMode,
    setActiveViewMode,
    isFullscreen,
    setIsFullscreen,
  } = useUIStore()
  const isResolvedMode = filters.state === 'resolved'
  const isSuppressedMode = filters.state === 'suppressed'
  const isActiveMode = !isResolvedMode && !isSuppressedMode

  const { data: liveAlerts = [], isLoading: liveLoading } = useAlerts()
  const resolvedQuery = useAlerts({ state: 'resolved' }, { enabled: isResolvedMode })
  const {
    data: resolvedAlerts = [],
    isLoading: resolvedLoading,
    isError: resolvedError,
    refetch: retryResolved,
  } = resolvedQuery
  const { data: silences = [] } = useSilences()
  const queryClient = useQueryClient()
  const wasResolvedMode = useRef(isResolvedMode)

  useEffect(() => {
    if (wasResolvedMode.current && !isResolvedMode) {
      void queryClient.cancelQueries({ queryKey: ['alerts', { state: 'resolved' }], exact: true })
    }
    wasResolvedMode.current = isResolvedMode
  }, [isResolvedMode, queryClient])

  const alerts = isResolvedMode ? resolvedAlerts : liveAlerts
  const isLoading = isResolvedMode ? resolvedLoading : liveLoading

  // Search panel — auto-open when URL contains a search param
  const [searchOpen, setSearchOpen] = useState(() => Boolean(filters.search))
  const [cardGroupingEnabled, setCardGroupingEnabled] = useState(loadCardGroupingEnabled)
  const [overviewOpen, setOverviewOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])


  function toggleSearch() {
    if (searchOpen) {
      setFilter('search', '')
      setSearchOpen(false)
    } else {
      setSearchOpen(true)
    }
  }

  function toggleCardGrouping(enabled: boolean) {
    setCardGroupingEnabled(enabled)
    try {
      window.localStorage.setItem(CARD_GROUPING_KEY, String(enabled))
    } catch {
      // ignore write errors
    }
  }

  const [hintVisible, setHintVisible] = useState(false)

  useEffect(() => {
    if (!isFullscreen) { setHintVisible(false); return }
    setHintVisible(true)
    const t = setTimeout(() => setHintVisible(false), 2500)
    return () => clearTimeout(t)
  }, [isFullscreen])

  useEffect(() => {
    if (!isFullscreen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isFullscreen, setIsFullscreen])

  // Filter alerts
  const filtered: EnrichedAlert[] = alerts.filter((alert) => {
    if (!matchesAlertSearch(alert, filters.search)) return false

    if (filters.state && !isResolvedMode) {
      const effectiveState = getEffectiveAlertState(alert, silences)
      if (effectiveState !== filters.state) return false
    }

    if (!matchesLabelMatchers(alert, filters.labelMatchers)) return false

    return true
  })

  const selectedAlert = (() => {
    if (!selectedFingerprint) return null
    const selected = parseAlertSelectionKey(selectedFingerprint)
    if (selected.clusterName) {
      return filtered.find((a) => a.fingerprint === selected.fingerprint && a.clusterName === selected.clusterName) ??
        alerts.find((a) => a.fingerprint === selected.fingerprint && a.clusterName === selected.clusterName) ??
        null
    }
    return filtered.find((a) => a.fingerprint === selected.fingerprint) ??
      alerts.find((a) => a.fingerprint === selected.fingerprint) ??
      null
  })()
  const showsCardGrid = viewMode === 'card' && !isResolvedMode
  const canToggleGrouping = !isResolvedMode

  return (
    <div className={`flex flex-col gap-4${isFullscreen ? ' pt-4' : ''}`}>
      {/* Sub-header: filter inputs + active chips + view controls */}
      {!isFullscreen && (
          <div data-testid="alerts-toolbar" className="flex items-center gap-2 px-4 flex-wrap">
            {/* Saved filters quick-select/manage menu */}
            <SavedFiltersMenu />

            {/* Active matcher chips + inline add */}
            <MatcherChipsBar allowAdd />

            {/* Right controls */}
            <div className="flex items-center gap-2 shrink-0 ml-auto">
              <button
                onClick={() => setOverviewOpen(true)}
                className="cursor-pointer flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent/40"
                title="Alerts overview"
                aria-label="Open alerts overview"
              >
                <ChartPie className="h-3.5 w-3.5" />
              </button>
              {!isResolvedMode && (
                <ViewToggle value={viewMode} onChange={(mode) => { setViewMode(mode); setActiveViewMode(mode) }} />
              )}
              {canToggleGrouping && (
                <GroupingControl
                  alerts={liveAlerts}
                  enabled={cardGroupingEnabled}
                  onToggleEnabled={toggleCardGrouping}
                />
              )}
              <div className="flex items-center rounded-md border border-border overflow-hidden">
                <button
                  onClick={() => { setFilter('state', 'active'); setViewMode(activeViewMode) }}
                  className={`cursor-pointer flex items-center gap-1.5 h-7 text-xs font-medium transition-colors ${
                    isActiveMode ? 'px-2.5 bg-accent text-foreground' : 'px-2 text-muted-foreground hover:text-foreground'
                  }`}
                  title="Active"
                >
                  <Siren className="h-3 w-3 shrink-0" />
                  {isActiveMode && 'Active'}
                </button>
                <button
                  onClick={() => { setFilter('state', 'suppressed'); setViewMode(activeViewMode) }}
                  className={`cursor-pointer flex items-center gap-1.5 h-7 text-xs font-medium transition-colors ${
                    isSuppressedMode ? 'px-2.5 bg-accent text-foreground' : 'px-2 text-muted-foreground hover:text-foreground'
                  }`}
                  title="Suppressed"
                >
                  <BellOff className="h-3 w-3 shrink-0" />
                  {isSuppressedMode && 'Suppressed'}
                </button>
                <button
                  onClick={() => { if (!isResolvedMode) setActiveViewMode(viewMode); setFilter('state', 'resolved'); setViewMode('list') }}
                  className={`cursor-pointer flex items-center gap-1.5 h-7 text-xs font-medium transition-colors ${
                    isResolvedMode ? 'px-2.5 bg-accent text-foreground' : 'px-2 text-muted-foreground hover:text-foreground'
                  }`}
                  title="Resolved"
                >
                  <CheckCircle2 className="h-3 w-3 shrink-0" />
                  {isResolvedMode && 'Resolved'}
                </button>
              </div>
              {searchOpen ? (
                <div className="flex items-center rounded-md border border-border overflow-hidden bg-input h-7">
                  <Search className="ml-2 h-3 w-3 text-muted-foreground shrink-0 pointer-events-none" />
                  <Input
                    ref={searchInputRef}
                    value={filters.search}
                    onChange={(e) => setFilter('search', e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setFilter('search', '')
                        setSearchOpen(false)
                      }
                    }}
                    placeholder="Search alerts…"
                    className="h-full w-44 text-xs border-0 bg-transparent shadow-none focus-visible:ring-0 px-2"
                    aria-label="Search alerts"
                  />
                  <button
                    onClick={toggleSearch}
                    className="cursor-pointer h-full px-2 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Close search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center rounded-md border border-border overflow-hidden">
                  <button
                    onClick={toggleSearch}
                    className="cursor-pointer h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    title="Search"
                    aria-label="Toggle search"
                  >
                    <Search className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="flex items-center rounded-md border border-border overflow-hidden">
                <button
                  onClick={() => setIsFullscreen(true)}
                  className="cursor-pointer h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title="Fullscreen (ESC to exit)"
                  aria-label="Enter fullscreen"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
      )}

      {/* ESC hint */}
      {isFullscreen && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center pointer-events-none select-none transition-opacity duration-700 ${hintVisible ? 'opacity-100' : 'opacity-0'}`}
          style={{ backdropFilter: hintVisible ? 'blur(2px)' : undefined }}
        >
          <div className="px-12 py-8 rounded-2xl shadow-2xl bg-neutral-900/95 dark:bg-neutral-100/95 text-neutral-100 dark:text-neutral-900 text-xl font-semibold flex items-center gap-4 border border-neutral-700 dark:border-neutral-300">
            Press
            <kbd className="px-4 py-2 rounded-lg bg-neutral-700 dark:bg-neutral-300 font-mono text-lg leading-none">ESC</kbd>
            to exit fullscreen
          </div>
        </div>
      )}

      {/* Content */}
      {isResolvedMode && resolvedError && resolvedAlerts.length === 0 ? (
        <div className="flex items-center gap-3 px-4 text-sm text-destructive" role="alert">
          <span>Failed to load resolved alerts.</span>
          <button
            type="button"
            className="cursor-pointer rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
            onClick={() => void retryResolved()}
          >
            Retry
          </button>
        </div>
      ) : isLoading ? (
        <div
          className="flex items-center gap-2 px-4 text-sm text-muted-foreground"
          role="status"
          data-testid={isResolvedMode ? 'resolved-loading' : undefined}
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : showsCardGrid ? (
        <div className="px-4">
          <AlertCardGrid
            alerts={filtered}
            silences={silences}
            onSelectAlert={setSelectedFingerprint}
            selectedFingerprint={selectedFingerprint}
            groupingEnabled={cardGroupingEnabled}
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
            resolvedMode={isResolvedMode}
            groupingEnabled={cardGroupingEnabled}
          />
        </div>
      )}

      {isResolvedMode && resolvedError && resolvedAlerts.length > 0 && (
        <div className="flex items-center gap-3 px-4 text-xs text-destructive" role="alert">
          <span>Could not refresh resolved alerts. Showing the previous result.</span>
          <button
            type="button"
            className="cursor-pointer rounded-md border border-border px-2 py-1 text-foreground hover:bg-accent"
            onClick={() => void retryResolved()}
          >
            Retry
          </button>
        </div>
      )}

      {/* Detail panel */}
      <AlertDetailPanel
        alert={selectedAlert}
        onClose={() => setSelectedFingerprint(null)}
        onAddLabelMatcher={addLabelMatcher}
        runbookBaseUrl={providerInfo?.runbookBaseUrl}
        silences={silences}
        onSelectAlert={setSelectedFingerprint}
      />

      <AlertsOverviewModal open={overviewOpen} onClose={() => setOverviewOpen(false)} />
    </div>
  )
}
