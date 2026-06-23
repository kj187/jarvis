import { useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Search, X, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ViewToggle } from './ViewToggle'
import { MatcherChipsBar } from '@/components/layout/MatcherChipsBar'
import { useAlerts } from '@/hooks/useAlerts'
import { useSilences } from '@/hooks/useSilences'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { AlertCardGrid } from './AlertCardGrid'
import { AlertListView } from './AlertListView'
import { AlertDetailPanel } from './AlertDetailPanel'
import { matchesLabelMatchers, getEffectiveAlertState, getFilterableLabels } from '@/lib/alertUtils'
import type { EnrichedAlert, LabelMatcherOperator } from '@/types'

const OPERATORS: LabelMatcherOperator[] = ['=', '!=', '=~', '!~']

// ── Custom autocomplete input ─────────────────────────────────────────────────

function ComboInput({
  value,
  onChangeValue,
  placeholder,
  options,
  className,
  style,
  onKeyDown,
  ariaLabel,
}: {
  value: string
  onChangeValue: (v: string) => void
  placeholder?: string
  options: string[]
  className?: string
  style?: React.CSSProperties
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const filtered = options.filter(
    (o) => !value || o.toLowerCase().includes(value.toLowerCase()),
  )

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={value}
        onChange={(e) => onChangeValue(e.target.value)}
        placeholder={placeholder}
        className={className}
        style={style}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
          onKeyDown?.(e)
        }}
        aria-label={ariaLabel}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-full max-h-48 overflow-y-auto rounded border border-border shadow-lg combo-dropdown bg-input">
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                onChangeValue(opt)
                setOpen(false)
              }}
              className="w-full px-3 py-1.5 text-left text-xs text-foreground hover:bg-accent/60 cursor-pointer whitespace-nowrap"
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── URL state sync ────────────────────────────────────────────────────────────

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

// ── AlertsPage ────────────────────────────────────────────────────────────────

export function AlertsPage() {
  useURLState()

  const isResolvedMode = useUIStore((s) => s.filters.state === 'resolved')
  const providerInfo = useAuthStore((s) => s.providerInfo)

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
    setFilter,
    setViewMode,
    activeViewMode,
    setActiveViewMode,
    isFullscreen,
    setIsFullscreen,
  } = useUIStore()

  // Filter inputs state
  const [newName, setNewName] = useState('')
  const [newOp, setNewOp] = useState<LabelMatcherOperator>('=')
  const [newValue, setNewValue] = useState('')

  // Search panel — auto-open when URL contains a search param
  const [searchOpen, setSearchOpen] = useState(() => Boolean(filters.search))
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  // Label autocomplete map built from live alerts
  const labelValueMap = useMemo(() => {
    const map = new Map<string, Set<string>>()
    liveAlerts.forEach((a) => {
      Object.entries(getFilterableLabels(a)).forEach(([k, v]) => {
        if (!v) return
        if (!map.has(k)) map.set(k, new Set())
        map.get(k)!.add(v)
      })
    })
    return map
  }, [liveAlerts])

  const availableLabelNames = useMemo(
    () => Array.from(labelValueMap.keys()).sort(),
    [labelValueMap],
  )

  const newValueOptions = useMemo(() => {
    if (newName && labelValueMap.has(newName)) {
      return Array.from(labelValueMap.get(newName)!).sort()
    }
    const all = new Set<string>()
    labelValueMap.forEach((vals) => vals.forEach((v) => all.add(v)))
    return Array.from(all).sort()
  }, [labelValueMap, newName])

  function handleAddMatcher() {
    if (!newName || !newValue) return
    addLabelMatcher({ name: newName, operator: newOp, value: newValue })
    setNewName('')
    setNewOp('=')
    setNewValue('')
  }

  function toggleSearch() {
    if (searchOpen) {
      setFilter('search', '')
      setSearchOpen(false)
    } else {
      setSearchOpen(true)
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
    if (filters.search) {
      const needle = filters.search.toLowerCase()
      const haystack = (alert.labels['alertname'] ?? '') + JSON.stringify(alert.labels)
      if (!haystack.toLowerCase().includes(needle)) return false
    }

    if (filters.state && !isResolvedMode) {
      const effectiveState = getEffectiveAlertState(alert, silences)
      if (effectiveState !== filters.state) return false
    }

    if (!matchesLabelMatchers(alert, filters.labelMatchers)) return false

    return true
  })

  const selectedAlert = selectedFingerprint
    ? filtered.find((a) => a.fingerprint === selectedFingerprint) ??
      alerts.find((a) => a.fingerprint === selectedFingerprint) ??
      null
    : null

  return (
    <div className={`flex flex-col gap-4${isFullscreen ? ' pt-4' : ''}`}>
      {/* Sub-header: filter inputs + active chips + view controls */}
      {!isFullscreen && (
          <div className="flex items-center gap-2 px-4 flex-wrap">
            {/* Filter inputs — left of active matcher chips */}
            <div className="flex items-center gap-1 shrink-0">
              <ComboInput value={newName} onChangeValue={setNewName} placeholder="label" options={availableLabelNames} className="h-7 w-24 text-xs bg-input" onKeyDown={(e) => e.key === 'Enter' && handleAddMatcher()} ariaLabel="Label name" />
              <Select value={newOp} onChange={(e) => setNewOp(e.target.value as LabelMatcherOperator)} className="h-7 w-14 shrink-0" selectClassName="text-xs font-mono" aria-label="Operator">
                {OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
              </Select>
              <ComboInput value={newValue} onChangeValue={setNewValue} placeholder="value" options={newValueOptions} className="h-7 w-32 text-xs bg-input" onKeyDown={(e) => e.key === 'Enter' && handleAddMatcher()} ariaLabel="Label value" />
              <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" onClick={handleAddMatcher} disabled={!newName || !newValue} aria-label="Add filter">
                <Plus className="h-3 w-3" />
              </Button>
            </div>

            {/* Active matcher chips */}
            <MatcherChipsBar />

            {/* Right controls */}
            <div className="flex items-center gap-2 shrink-0 ml-auto">
              {!isResolvedMode && (
                <ViewToggle value={viewMode} onChange={(mode) => { setViewMode(mode); setActiveViewMode(mode) }} />
              )}
              <div className="flex items-center rounded-md border border-border overflow-hidden">
                <button
                  onClick={() => { setFilter('state', 'active'); setViewMode(activeViewMode) }}
                  className={`cursor-pointer px-2.5 h-7 text-xs font-medium transition-colors ${
                    !isResolvedMode ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Active
                </button>
                <button
                  onClick={() => { if (!isResolvedMode) setActiveViewMode(viewMode); setFilter('state', 'resolved'); setViewMode('list') }}
                  className={`cursor-pointer px-2.5 h-7 text-xs font-medium transition-colors ${
                    isResolvedMode ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Resolved
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
        runbookBaseUrl={providerInfo?.runbookBaseUrl}
        silences={silences}
      />
    </div>
  )
}
