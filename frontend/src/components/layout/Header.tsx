import { useRef, useState, useMemo, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Wifi, WifiOff, RefreshCw, Play, Pause, Search, X, Plus, Settings, Lock, CircleUser, LogOut, User, Shield, Sun, Moon, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Sheet } from '@/components/ui/sheet'
import { ViewToggle } from '@/components/alerts/ViewToggle'
import { SilenceForm } from '@/components/silences/SilenceForm'
import { SettingsSheet } from '@/components/settings/SettingsSheet'
import { LoginModal } from '@/components/auth/LoginModal'
import { UserManagement } from '@/components/admin/UserManagement'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { useSettingsStore } from '@/store/useSettingsStore'
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

// ── Locked (read-only) matcher chip from Settings default filter ──────────────

function LockedMatcherChip({
  name,
  operator,
  value,
}: {
  name: string
  operator: string
  value: string
}) {
  return (
    <div
      className="flex items-center rounded border border-border/60 h-7 opacity-75 bg-input"
      title="Default filter set in Settings — open Settings (⚙) to change or remove"
    >
      <span className="px-2 text-xs text-muted-foreground shrink-0 select-none whitespace-nowrap overflow-hidden text-ellipsis" style={{ maxWidth: '120px' }}>
        {name}
      </span>
      <div className="h-3.5 w-px bg-border shrink-0" />
      <span className="px-1.5 text-xs text-muted-foreground font-mono shrink-0">{operator}</span>
      <div className="h-3.5 w-px bg-border shrink-0" />
      <span className="px-2 text-xs text-foreground shrink-0">{value}</span>
      <Lock className="mr-1.5 ml-0.5 h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />
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
    <div className="flex items-center rounded border border-border h-7 bg-input">
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
  const [clusterFilterOpen, setClusterFilterOpen] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [newName, setNewName] = useState('')
  const [newOp, setNewOp] = useState<LabelMatcherOperator>('=')
  const [newValue, setNewValue] = useState('')

  const [menuOpen, setMenuOpen] = useState(false)
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loginModalOpen, setLoginModalOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const { user, isAuthenticated, logout, providerInfo } = useAuthStore()
  const theme = useSettingsStore((s) => s.theme)
  const updateSettings = useSettingsStore((s) => s.update)

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

  // ── Shared filter input content ───────────────────────────────────────────
  const filterInputsContent = (
    <>
      <ComboInput value={newName} onChangeValue={setNewName} placeholder="label" options={availableLabelNames} className="h-7 w-24 text-xs bg-input" onKeyDown={(e) => e.key === 'Enter' && handleAddMatcher()} ariaLabel="Label name" />
      <Select value={newOp} onChange={(e) => setNewOp(e.target.value as LabelMatcherOperator)} className="h-7 w-14 shrink-0" selectClassName="text-xs font-mono" aria-label="Operator">
        {OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
      </Select>
      <ComboInput value={newValue} onChangeValue={setNewValue} placeholder="value" options={newValueOptions} className="h-7 w-32 text-xs bg-input" onKeyDown={(e) => e.key === 'Enter' && handleAddMatcher()} ariaLabel="Label value" />
      <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" onClick={handleAddMatcher} disabled={!newName || !newValue} aria-label="Add filter">
        <Plus className="h-3 w-3" />
      </Button>
    </>
  )

  // ── Shared active matcher chips ───────────────────────────────────────────
  const activeChipsContent = filters.labelMatchers.map((m) =>
    m.locked ? (
      <LockedMatcherChip key={m.id} name={m.name} operator={m.operator} value={m.value} />
    ) : (
      <MatcherChip key={m.id} id={m.id} name={m.name} operator={m.operator} value={m.value} valueOptions={Array.from(labelValueMap.get(m.name) ?? []).sort()} onUpdate={(partial) => updateLabelMatcher(m.id, partial)} onRemove={() => removeLabelMatcher(m.id)} />
    ),
  )

  return (
    <>
    <header className="sticky top-0 z-30 border-b border-border backdrop-blur bg-header">

      {/* ── Main row (always visible) ── */}
      <div className="flex items-center gap-1.5 px-3 py-1.5">

        {/* Filter inputs inline — xl+ (drops to row below when window narrows) */}
        <div className="hidden xl:flex items-center gap-1 shrink-0">
          {filterInputsContent}
        </div>

        {/* STATE pills */}
        <div
          className="flex items-center gap-0.5 shrink-0 rounded-md px-1 py-0.5 bg-input border border-border"
          role="group"
          aria-label="State filter"
        >
          <span className="hidden sm:inline text-xs text-muted-foreground shrink-0 select-none px-1.5">STATE</span>
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
                <span className="hidden sm:inline">{label}</span>
                {value !== 'resolved' && <span className="tabular-nums opacity-75">{count}</span>}
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

        {/* ViewToggle — desktop only */}
        <div className="hidden md:block">
          {(!filters.state || filters.state === 'active') && (
            <ViewToggle value={viewMode} onChange={setViewMode} />
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* ── Desktop controls ── */}
        <div className="hidden md:flex items-center gap-1.5">
          {/* Cluster status */}
          <div
            className="relative shrink-0"
            onMouseEnter={() => setClusterHoverOpen(true)}
            onMouseLeave={() => setClusterHoverOpen(false)}
          >
            <div
              className="flex items-center gap-1.5 px-2 py-1 text-xs cursor-default select-none"
              aria-label={`Instances ${healthyCount}/${clusters.length}`}
              title={`Instances ${healthyCount}/${clusters.length}`}
            >
              <div className={`h-2 w-2 rounded-full ${healthyCount === clusters.length ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-muted-foreground tabular-nums">{healthyCount}/{clusters.length}</span>
            </div>
            {clusterHoverOpen && clusters.length > 0 && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[26rem] rounded-md border border-border bg-card shadow-lg" role="tooltip">
                <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border">Connected Instances</div>
                {clusters.map((c) => (
                  <div
                    key={c.name}
                    className={`px-3 py-2 border-b border-border last:border-0 ${!c.healthy ? 'bg-red-950/30' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="relative flex items-center gap-2">
                        {c.healthy ? (
                          <div className="h-2 w-2 rounded-full shrink-0 bg-green-500" />
                        ) : (
                          <div className="relative shrink-0">
                            <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                            <div className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-75" />
                          </div>
                        )}
                        <div className="relative">
                          <button
                            className="text-xs font-medium text-foreground hover:text-blue-400 cursor-pointer"
                            onMouseEnter={() => setClusterFilterOpen(c.name)}
                            onMouseLeave={() => setClusterFilterOpen(null)}
                            onClick={() => {
                              addLabelMatcher({ name: '@cluster', operator: '=', value: c.name })
                              setClusterHoverOpen(false)
                            }}
                          >
                            {c.name}
                          </button>
                          {clusterFilterOpen === c.name && (
                            <div
                              className="absolute left-0 top-full mt-0.5 z-60 rounded border border-border bg-popover shadow-md text-[11px]"
                              onMouseEnter={() => setClusterFilterOpen(c.name)}
                              onMouseLeave={() => setClusterFilterOpen(null)}
                            >
                              {(['=', '!='] as const).map((op) => (
                                <button
                                  key={op}
                                  className="flex w-full items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 text-left hover:bg-accent cursor-pointer"
                                  onClick={() => {
                                    addLabelMatcher({ name: '@cluster', operator: op, value: c.name })
                                    setClusterFilterOpen(null)
                                    setClusterHoverOpen(false)
                                  }}
                                >
                                  <span className="font-mono text-muted-foreground">@cluster</span>
                                  <span className="font-mono text-blue-400">{op}</span>
                                  <span className="font-medium text-foreground">{c.name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {!c.healthy && (
                          <span className="rounded bg-red-500/20 px-1 py-0.5 text-[10px] font-semibold text-red-400 uppercase tracking-wide">DOWN</span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{c.alertCount} Alerts</span>
                    </div>
                    <div className="mt-1 pl-[1.375rem] text-[10px] text-muted-foreground/60 break-all">{c.alertmanagerUrl}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* WS status */}
          <div className="shrink-0" title={wsConnected ? 'WebSocket connected' : 'WebSocket disconnected'}>
            {wsConnected ? <Wifi className="h-4 w-4 text-green-500" /> : <WifiOff className="h-4 w-4 text-red-500" />}
          </div>

          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setPollingPaused(!pollingPaused)} title={pollingPaused ? 'Resume polling' : 'Pause polling'}>
            {pollingPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleRefresh} title="Refresh now" disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${isSpinning ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={toggleSearch} title="Search" aria-pressed={searchOpen}>
            {searchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Open settings">
            <Settings className="h-4 w-4" />
          </Button>

          {/* Auth — desktop */}
          {isAuthenticated && user ? (
            <div className="relative shrink-0">
              <button
                className="flex items-center justify-center h-8 w-8 rounded cursor-pointer text-foreground hover:bg-accent/60"
                onClick={() => setUserMenuOpen((v) => !v)}
                aria-label="User menu"
                title={user.username}
              >
                <User className="h-4 w-4" />
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 min-w-40 rounded-md border border-border bg-card shadow-lg" onMouseLeave={() => setUserMenuOpen(false)}>
                  <div className="px-3 py-2 text-xs font-medium text-foreground border-b border-border">{user.username}</div>
                  {user.role === 'admin' && (
                    <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-accent/60 cursor-pointer border-b border-border" onClick={() => { setUserMenuOpen(false); setAdminOpen(true) }}>
                      <Shield className="h-3.5 w-3.5" />Admin
                    </button>
                  )}
                  <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-accent/60 cursor-pointer" onClick={() => { setUserMenuOpen(false); logout() }}>
                    <LogOut className="h-3.5 w-3.5" />Logout
                  </button>
                </div>
              )}
            </div>
          ) : providerInfo !== null && providerInfo.mode !== 'none' ? (
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setLoginModalOpen(true)} title="Login" aria-label="Login">
              <CircleUser className="h-4 w-4" />
            </Button>
          ) : null}

          <Button size="sm" onClick={() => setSilenceFormOpen(true)} className="h-7 text-xs shrink-0">
            <Plus className="mr-1 h-3.5 w-3.5" />
            Create silence
          </Button>
        </div>

        {/* ── Mobile: WS status + hamburger ── */}
        <div className="flex md:hidden items-center gap-1">
          <div className="shrink-0" title={wsConnected ? 'WebSocket connected' : 'WebSocket disconnected'}>
            {wsConnected ? <Wifi className="h-4 w-4 text-green-500" /> : <WifiOff className="h-4 w-4 text-red-500" />}
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setMenuOpen((v) => !v)} aria-label="Toggle menu" aria-expanded={menuOpen}>
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* ── Filter + chips row — md to xl (single row, max 2 header rows total) ── */}
      <div className="hidden md:flex xl:hidden items-center gap-1.5 px-3 pb-1.5 flex-wrap">
        <div className="flex items-center gap-1 shrink-0">
          {filterInputsContent}
        </div>
        {activeChipsContent}
      </div>

      {/* ── Chips row — xl+ only (filter already inline in row 1) ── */}
      {filters.labelMatchers.length > 0 && (
        <div className="hidden xl:flex items-center gap-1.5 px-3 pb-1.5 flex-wrap">
          {activeChipsContent}
        </div>
      )}

      {/* ── Mobile hamburger panel ── */}
      {menuOpen && (
        <div className="md:hidden border-t border-border px-3 py-3 space-y-3">
          {/* Filter inputs */}
          <div className="flex items-center gap-1 flex-wrap">
            {filterInputsContent}
          </div>

          {/* Active matcher chips */}
          {filters.labelMatchers.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {activeChipsContent}
            </div>
          )}

          {/* Controls row */}
          <div className="flex items-center gap-1 flex-wrap">
            {(!filters.state || filters.state === 'active') && (
              <ViewToggle value={viewMode} onChange={setViewMode} />
            )}
            <div className="flex-1" />
            {/* Cluster status */}
            <div className="flex items-center gap-1.5 px-2 text-xs cursor-default select-none" title={`Instances ${healthyCount}/${clusters.length}`}>
              <div className={`h-2 w-2 rounded-full ${healthyCount === clusters.length ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-muted-foreground tabular-nums">{healthyCount}/{clusters.length}</span>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPollingPaused(!pollingPaused)} title={pollingPaused ? 'Resume polling' : 'Pause polling'}>
              {pollingPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleRefresh} title="Refresh now" disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${isSpinning ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleSearch} title="Search" aria-pressed={searchOpen}>
              {searchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSettingsOpen(true); setMenuOpen(false) }} title="Settings">
              <Settings className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={() => { setSilenceFormOpen(true); setMenuOpen(false) }} className="h-7 text-xs">
              <Plus className="mr-1 h-3.5 w-3.5" />Create silence
            </Button>
            {isAuthenticated && user ? (
              <button className="flex items-center justify-center h-8 w-8 rounded cursor-pointer text-foreground hover:bg-accent/60" onClick={() => setUserMenuOpen((v) => !v)} aria-label="User menu" title={user.username}>
                <User className="h-4 w-4" />
              </button>
            ) : providerInfo !== null && providerInfo.mode !== 'none' ? (
              <button className="flex items-center justify-center h-8 w-8 rounded cursor-pointer text-muted-foreground hover:text-foreground hover:bg-accent/60" onClick={() => { setLoginModalOpen(true); setMenuOpen(false) }} title="Login" aria-label="Login">
                <CircleUser className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {/* User menu expanded (mobile) */}
          {isAuthenticated && user && userMenuOpen && (
            <div className="border border-border rounded-md bg-card">
              <div className="px-3 py-2 text-xs font-medium text-foreground border-b border-border">{user.username}</div>
              {user.role === 'admin' && (
                <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-accent/60 cursor-pointer border-b border-border" onClick={() => { setUserMenuOpen(false); setAdminOpen(true); setMenuOpen(false) }}>
                  <Shield className="h-3.5 w-3.5" />Admin
                </button>
              )}
              <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-accent/60 cursor-pointer" onClick={() => { setUserMenuOpen(false); logout(); setMenuOpen(false) }}>
                <LogOut className="h-3.5 w-3.5" />Logout
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Search bar ── */}
      {searchOpen && (
        <div className="px-3 pb-2">
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
              <button onClick={() => setFilter('search', '')} className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground" aria-label="Clear search">
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

    <SettingsSheet
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      availableLabelNames={availableLabelNames}
      labelValueMap={labelValueMap}
    />

    <LoginModal
      open={loginModalOpen}
      onSuccess={() => setLoginModalOpen(false)}
      onClose={() => setLoginModalOpen(false)}
    />

    <Sheet open={adminOpen} onClose={() => setAdminOpen(false)}>
      <div className="p-5 pt-10">
        <h2 className="mb-4 text-base font-semibold">User Management</h2>
        <UserManagement />
      </div>
    </Sheet>
    </>
  )
}
