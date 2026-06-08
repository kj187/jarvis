import { useRef, useState, useMemo, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Wifi, WifiOff, RefreshCw, Play, Pause, Search, X, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Sheet } from '@/components/ui/sheet'
import { ViewToggle } from '@/components/alerts/ViewToggle'
import { SilenceForm } from '@/components/silences/SilenceForm'
import { useUIStore } from '@/store/uiStore'
import { useQuery } from '@tanstack/react-query'
import { fetchClusters } from '@/api/client'
import { useAlerts } from '@/hooks/useAlerts'
import type { LabelMatcherOperator } from '@/types'

const STATE_OPTIONS = [
  { value: 'active',     label: 'Active',     dot: 'bg-orange-400', activeBg: 'bg-orange-500',  activeDot: 'bg-white' },
  { value: 'suppressed', label: 'Suppressed', dot: 'bg-blue-400',   activeBg: 'bg-blue-500',    activeDot: 'bg-white' },
  { value: 'resolved',   label: 'Resolved',   dot: 'bg-green-500',  activeBg: 'bg-green-600',   activeDot: 'bg-white' },
] as const

type StateValue = typeof STATE_OPTIONS[number]['value']

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
        <div className="absolute left-0 top-full mt-1 z-50 min-w-full max-h-48 overflow-y-auto rounded border border-border shadow-lg combo-dropdown" style={{ backgroundColor: '#18181B' }}>
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

// ── Inline editable matcher chip ─────────────────────────────────────────────

function MatcherChip({
  id,
  name,
  operator,
  value,
  valueOptions,
  onUpdate,
  onRemove,
}: {
  id: string
  name: string
  operator: LabelMatcherOperator
  value: string
  valueOptions: string[]
  onUpdate: (partial: { name?: string; operator?: LabelMatcherOperator; value?: string }) => void
  onRemove: () => void
}) {
  const datalistId = `mc-vals-${id}`

  return (
    <div className="flex items-center rounded border border-border h-7" style={{ backgroundColor: '#18181B' }}>
      <datalist id={datalistId}>
        {valueOptions.map((v) => <option key={v} value={v} />)}
      </datalist>
      {/* Label name — static, sized to content */}
      <span
        className="px-2 text-xs text-muted-foreground shrink-0 select-none whitespace-nowrap overflow-hidden text-ellipsis"
        style={{ maxWidth: '120px' }}
      >
        {name}
      </span>
      <div className="h-3.5 w-px bg-border shrink-0" />
      <select
        value={operator}
        onChange={(e) => onUpdate({ operator: e.target.value as LabelMatcherOperator })}
        className="h-full w-14 bg-transparent px-1 text-xs text-muted-foreground focus:outline-none cursor-pointer border-0"
        aria-label={`Filter operator ${id}`}
      >
        {OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
      </select>
      <div className="h-3.5 w-px bg-border shrink-0" />
      {/* Value — editable, auto-width based on content */}
      <input
        value={value}
        onChange={(e) => onUpdate({ value: e.target.value })}
        list={datalistId}
        className="h-full bg-transparent px-2 text-xs text-foreground focus:outline-none [&::-webkit-calendar-picker-indicator]:hidden"
        style={{ width: `${Math.min(Math.max(8, value.length + 4), 28)}ch` }}
        aria-label={`Filter label value ${id}`}
      />
      <button
        onClick={onRemove}
        className="mr-1.5 ml-0.5 cursor-pointer text-muted-foreground hover:text-foreground shrink-0"
        aria-label={`Remove filter ${name}${operator}${value}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

// ── Header ────────────────────────────────────────────────────────────────────

export function Header() {
  const {
    viewMode,
    setViewMode,
    wsConnected,
    pollingPaused,
    setPollingPaused,
    filters,
    setFilter,
    addLabelMatcher,
    updateLabelMatcher,
    removeLabelMatcher,
    alertCounts,
  } = useUIStore()

  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [clusterHoverOpen, setClusterHoverOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const [newName, setNewName] = useState('')
  const [newOp, setNewOp] = useState<LabelMatcherOperator>('=')
  const [newValue, setNewValue] = useState('')

  const [pollSpinning, setPollSpinning] = useState(false)
  const pollSpinTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollingPausedRef = useRef(pollingPaused)
  useEffect(() => { pollingPausedRef.current = pollingPaused }, [pollingPaused])
  useEffect(() => {
    return qc.getQueryCache().subscribe((event) => {
      if (pollingPausedRef.current) return
      const action = (event as { type: string; query: { queryKey: unknown[] }; action?: { type: string } }).action
      const key = event.query?.queryKey
      if (event.type !== 'updated') return
      if (action?.type !== 'fetch' && action?.type !== 'success') return
      if (!Array.isArray(key) || key[0] !== 'alerts') return
      if (pollSpinTimer.current) clearTimeout(pollSpinTimer.current)
      setPollSpinning(true)
      pollSpinTimer.current = setTimeout(() => setPollSpinning(false), 800)
    })
  }, [qc])

  const { data: clusters = [] } = useQuery({
    queryKey: ['clusters'],
    queryFn: fetchClusters,
    refetchInterval: 30_000,
  })

  const [silenceFormOpen, setSilenceFormOpen] = useState(false)

  const { data: allAlerts = [] } = useAlerts()

  // label → sorted unique values map
  const labelValueMap = useMemo(() => {
    const map = new Map<string, Set<string>>()
    allAlerts.forEach((a) => {
      Object.entries(a.labels).forEach(([k, v]) => {
        if (!map.has(k)) map.set(k, new Set())
        map.get(k)!.add(v)
      })
    })
    return map
  }, [allAlerts])

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

  const healthyCount = clusters.filter((c) => c.healthy).length

  async function handleRefresh() {
    setRefreshing(true)
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['alerts'] }),
      new Promise((r) => setTimeout(r, 600)),
    ])
    setRefreshing(false)
  }

  function toggleSearch() {
    if (searchOpen) {
      setFilter('search', '')
      setSearchOpen(false)
    } else {
      setSearchOpen(true)
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }

  function handleSearchKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setFilter('search', '')
      setSearchOpen(false)
    }
  }

  function handleAddMatcher() {
    if (!newName || !newValue) return
    addLabelMatcher({ name: newName, operator: newOp, value: newValue })
    setNewName('')
    setNewOp('=')
    setNewValue('')
  }

  function toggleState(value: string) {
    const next = filters.state === value ? '' : value
    setFilter('state', next)
    if (next !== 'active') setViewMode('list')
  }

  const isSpinning = refreshing || pollSpinning

  return (
    <>
    <header className="sticky top-0 z-30 border-b border-border backdrop-blur" style={{ backgroundColor: '#172131' }}>
      {/* ── Main row ── */}
      <div className="flex items-center gap-2 px-4 py-2">

        {/* Label filter add row */}
        <div className="flex items-center gap-1 shrink-0">
          <ComboInput
            value={newName}
            onChangeValue={setNewName}
            placeholder="label"
            options={availableLabelNames}
            className="h-7 w-32 text-xs"
            style={{ backgroundColor: '#18181B' }}
            onKeyDown={(e) => e.key === 'Enter' && handleAddMatcher()}
            ariaLabel="Label name"
          />
          <Select
            value={newOp}
            onChange={(e) => setNewOp(e.target.value as LabelMatcherOperator)}
            className="h-7 w-14 shrink-0"
            selectClassName="text-xs font-mono"
            aria-label="Operator"
          >
            {OPERATORS.map((op) => (
              <option key={op} value={op}>{op}</option>
            ))}
          </Select>
          <ComboInput
            value={newValue}
            onChangeValue={setNewValue}
            placeholder="value"
            options={newValueOptions}
            className="h-7 w-44 text-xs"
            style={{ backgroundColor: '#18181B' }}
            onKeyDown={(e) => e.key === 'Enter' && handleAddMatcher()}
            ariaLabel="Label value"
          />
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={handleAddMatcher}
            disabled={!newName || !newValue}
            aria-label="Add filter"
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>

        {/* Divider + STATE label + state pills */}
        <>
          <div className="mx-1 h-5 w-px bg-border shrink-0" />
          <div
            className="flex items-center gap-0.5 shrink-0 rounded-md px-1 py-0.5"
            style={{ backgroundColor: '#18181B', border: '1px solid #3F3F46' }}
            role="group"
            aria-label="State filter"
          >
          <span className="text-xs text-muted-foreground shrink-0 select-none px-1.5">STATE</span>
            {STATE_OPTIONS.map(({ value, label, dot, activeBg, activeDot }) => {
              const isActive = filters.state === value
              const count = alertCounts.byState?.[value as StateValue] ?? 0
              return (
                <button
                  key={value}
                  onClick={() => toggleState(value)}
                  className={`cursor-pointer flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? `${activeBg} text-white rounded-none`
                      : 'text-muted-foreground hover:text-foreground rounded-full'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${isActive ? activeDot : dot}`} />
                  {label}
                  <span className="tabular-nums opacity-75">{count}</span>
                </button>
              )
            })}
            <button
              onClick={() => { setFilter('state', ''); setViewMode('list') }}
              className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                !filters.state
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All
            </button>
          </div>
          <ViewToggle value={viewMode} onChange={setViewMode} />
        </>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Cluster status */}
        <div
          className="relative shrink-0"
          onMouseEnter={() => setClusterHoverOpen(true)}
          onMouseLeave={() => setClusterHoverOpen(false)}
        >
          <div
            className="flex items-center gap-1.5 px-2 py-1 text-xs cursor-default select-none"
            aria-label={`Instance ${healthyCount}/${clusters.length}`}
          >
            <div
              className={`h-2 w-2 rounded-full ${
                healthyCount === clusters.length ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="text-muted-foreground">
              Instances {healthyCount}/{clusters.length}
            </span>
          </div>

          {clusterHoverOpen && clusters.length > 0 && (
            <div
              className="absolute right-0 top-full mt-1 z-50 min-w-56 rounded-md border border-border bg-card shadow-lg"
              role="tooltip"
            >
              <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border">
                Connected Instances
              </div>
              {clusters.map((c) => (
                <div key={c.name} className="px-3 py-2 border-b border-border last:border-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5">
                      <div
                        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                          c.healthy ? 'bg-green-500' : 'bg-red-500'
                        }`}
                      />
                      <span className="text-xs font-medium text-foreground">{c.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {c.alertCount} Alerts
                    </span>
                  </div>
                  <div className="mt-0.5 pl-3 text-[10px] text-muted-foreground/60 truncate max-w-60">
                    {c.alertmanagerUrl}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* WS status */}
        <div
          className="flex items-center gap-1 shrink-0"
          title={wsConnected ? 'WebSocket connected' : 'WebSocket disconnected'}
        >
          {wsConnected
            ? <Wifi className="h-4 w-4 text-green-500" />
            : <WifiOff className="h-4 w-4 text-red-500" />}
          <span className={`text-xs ${wsConnected ? 'text-green-500' : 'text-red-400'}`}>
            {wsConnected ? 'Live' : 'Offline'}
          </span>
        </div>


        {/* Polling pause/resume */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => setPollingPaused(!pollingPaused)}
          title={pollingPaused ? 'Resume polling' : 'Pause polling'}
        >
          {pollingPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </Button>

        {/* Refresh */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={handleRefresh}
          title="Refresh now"
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 ${isSpinning ? 'animate-spin' : ''}`} />
        </Button>

        {/* Search toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={toggleSearch}
          title="Search"
          aria-pressed={searchOpen}
        >
          {searchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
        </Button>

        {/* Create silence — far right */}
        <Button
          size="sm"
          onClick={() => setSilenceFormOpen(true)}
          className="h-7 text-xs shrink-0"
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Create silence
        </Button>
      </div>

      {/* ── Active label matchers row — inline editable ── */}
      {filters.labelMatchers.length > 0 && (
        <div className="flex items-center gap-2 px-4 pb-2 flex-wrap">
          {filters.labelMatchers.map((m) => (
            <MatcherChip
              key={m.id}
              id={m.id}
              name={m.name}
              operator={m.operator}
              value={m.value}
              valueOptions={Array.from(labelValueMap.get(m.name) ?? []).sort()}
              onUpdate={(partial) => updateLabelMatcher(m.id, partial)}
              onRemove={() => removeLabelMatcher(m.id)}
            />
          ))}
        </div>
      )}

      {/* ── Search bar ── */}
      {searchOpen && (
        <div className="px-4 py-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              ref={searchRef}
              value={filters.search}
              onChange={(e) => setFilter('search', e.target.value)}
              onKeyDown={handleSearchKey}
              placeholder="Search by alert name, labels…"
              className="w-full pl-9 pr-9 h-9 text-sm"
              aria-label="Search alerts"
            />
            {filters.search && (
              <button
                onClick={() => setFilter('search', '')}
                className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </header>

    <Sheet open={silenceFormOpen} onClose={() => setSilenceFormOpen(false)}>
      <div className="p-5 pt-10">
        <h2 className="mb-4 text-base font-semibold">Create silence</h2>
        <SilenceForm
          availableClusters={clusters.map((c) => c.name).length > 0 ? clusters.map((c) => c.name) : ['default']}
          onSuccess={() => setSilenceFormOpen(false)}
          onCancel={() => setSilenceFormOpen(false)}
        />
      </div>
    </Sheet>
    </>
  )
}
