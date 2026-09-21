import { useRef, useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Wifi, WifiOff, RefreshCw, Plus, Settings, LogIn, LogOut, Shield, Sun, Moon, Menu, X, CircleUserRound, Info, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { Sheet } from '@/components/ui/sheet'
import { SilenceForm } from '@/components/silences/SilenceForm'
import { SilenceTemplateTab } from '@/components/silences/SilenceTemplateTab'
import { SettingsSheet } from '@/components/settings/SettingsSheet'
import { UserManagement } from '@/components/admin/UserManagement'
import { AccountSheet } from '@/components/account/AccountSheet'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { useQuery } from '@tanstack/react-query'
import { fetchClusters, fetchStatus } from '@/api/client'
import { FALLBACK_REFETCH_INTERVAL_MS } from '@/lib/refetch'
import { Tooltip } from '@/components/ui/tooltip'
import { useVersion } from '@/hooks/useVersion'
import { Popover } from '@/components/ui/popover'

function formatPollInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`
}

function refreshTooltip(pollIntervalSeconds: number | undefined): string {
  const interval = pollIntervalSeconds !== undefined ? formatPollInterval(pollIntervalSeconds) : null
  return (
    'Reloads the current snapshot from the Jarvis backend. Does not trigger a new Alertmanager poll — new data only ' +
    `appears once the backend's own poll${interval ? ` (every ${interval})` : ''} runs (already pushed to you live via WebSocket).`
  )
}

function InfoColophon({ version }: { version: string | null }) {
  return (
    <div className="p-4">
      <a
        href="https://github.com/kj187/jarvis"
        target="_blank"
        rel="noopener noreferrer"
        className="group flex flex-col items-center gap-2 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <img
          src="/logo.png"
          alt="Jarvis"
          width={80}
          height={80}
          className="h-20 w-20 select-none opacity-80 transition-opacity group-hover:opacity-100"
          draggable={false}
        />
        <span className="text-sm font-semibold tracking-tight text-foreground/90">Jarvis</span>
      </a>
      <div className="mt-3 space-y-0.5 text-center text-[11px] leading-relaxed text-muted-foreground">
        <p className="font-mono">{version ?? 'dev'} · Apache-2.0</p>
        <p>© 2026 Julian Kleinhans</p>
      </div>
    </div>
  )
}

// Live-connection indicator. Green icon when connected; when the socket is down it also says
// "Offline" in text, so the state never depends on hue or a hover-only title (the title stays for
// pointer users and tests).
function WsStatus({ connected }: { connected: boolean }) {
  const title = connected ? 'WebSocket connected' : 'WebSocket disconnected'
  return (
    <div
      className="flex shrink-0 items-center gap-1"
      role="img"
      aria-label={connected ? title : `Offline — ${title}`}
      title={title}
    >
      {connected ? <Wifi className="h-4 w-4 text-success-solid" /> : <WifiOff className="h-4 w-4 text-critical-solid" />}
      {!connected && (
        <span className="text-xs font-medium text-critical-fg">Offline</span>
      )}
    </div>
  )
}

// ── Header ────────────────────────────────────────────────────────────────────

export function Header() {
  const {
    activePage,
    setActivePage,
    wsConnected,
    filters,
    setFilter,
    addLabelMatcher,
    alertCounts,
  } = useUIStore()

  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const [clusterHoverOpen, setClusterHoverOpen] = useState(false)
  const [clusterFilterOpen, setClusterFilterOpen] = useState<string | null>(null)

  const [menuOpen, setMenuOpen] = useState(false)
  const [pollSpinning, setPollSpinning] = useState(false)
  const pollSpinTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return qc.getQueryCache().subscribe((event) => {
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
    refetchInterval: FALLBACK_REFETCH_INTERVAL_MS,
  })

  const { data: status } = useQuery({
    queryKey: ['status'],
    queryFn: fetchStatus,
    refetchInterval: FALLBACK_REFETCH_INTERVAL_MS,
  })
  const refreshTooltipText = refreshTooltip(status?.poll_interval_seconds)

  const [silenceFormOpen, setSilenceFormOpen] = useState(false)
  const [silenceActiveTab, setSilenceActiveTab] = useState<'silence' | 'templates'>('silence')
  const [settingsOpen, setSettingsOpen] = useState(
    () => new URLSearchParams(window.location.search).get('settings') === 'open',
  )
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const { user, isAuthenticated, logout, providerInfo, requestLogin } = useAuthStore()
  // A session that ends while the sheet is open must not reopen it after the next login.
  if (!user && accountOpen) setAccountOpen(false)
  const theme = useSettingsStore((s) => s.theme)
  const updateSettings = useSettingsStore((s) => s.update)
  const version = useVersion()

  // Desktop-only: these popovers open on hover, with a short close delay so
  // crossing the gap to the panel doesn't flicker-close it. Mobile has no
  // hover, so its own panels below share the same open state but stay purely
  // click-toggled.
  const [refreshTooltipOpen, setRefreshTooltipOpen] = useState(false)

  const healthyCount = clusters.filter((c) => c.healthy).length

  function setSettingsVisibility(open: boolean) {
    setSettingsOpen(open)
    const params = new URLSearchParams(window.location.search)
    if (open) params.set('settings', 'open')
    else params.delete('settings')
    const query = params.toString()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
    )
  }

  useEffect(() => {
    const syncFromURL = () => {
      setSettingsOpen(new URLSearchParams(window.location.search).get('settings') === 'open')
    }
    window.addEventListener('popstate', syncFromURL)
    return () => window.removeEventListener('popstate', syncFromURL)
  }, [])

  async function handleRefresh() {
    setRefreshing(true)
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['alerts'] }),
      new Promise((r) => setTimeout(r, 600)),
    ])
    setRefreshing(false)
  }

  const isSpinning = refreshing || pollSpinning

  return (
    <>
    <header className="sticky top-0 z-30 border-b border-border backdrop-blur bg-header">

      {/* ── Main row ── */}
      <div className="flex items-center h-11 px-3">

        {/* Brand mark — decorative (the product name lives in the About popover), so it adds
            no accessible name that could collide with the nav buttons' names. */}
        <img
          src="/logo.png"
          alt=""
          aria-hidden="true"
          width={28}
          height={28}
          data-testid="header-mark"
          className="mr-2.5 h-7 w-7 shrink-0 select-none"
          draggable={false}
        />

        {/* Nav tabs — always left */}
        <div className="flex self-stretch shrink-0" role="group" aria-label="Navigation">
          <button
            aria-current={activePage === 'alerts' ? 'page' : undefined}
            onClick={() => { setActivePage('alerts'); if (!filters.state) setFilter('state', 'active') }}
            className={`cursor-pointer self-end h-9 flex items-center pb-1.5 gap-1.5 px-4 text-xs font-medium transition-colors translate-y-px border border-b-0 rounded-t-compact ${
              activePage === 'alerts'
                ? 'border-border bg-background text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/20'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-pill bg-attention-solid ${activePage === 'alerts' ? '' : 'opacity-80'}`} />
            Alerts
            <span className="tabular-nums opacity-75">{alertCounts.byState?.active ?? 0}</span>
          </button>
          <button
            aria-current={activePage === 'silences' ? 'page' : undefined}
            onClick={() => setActivePage(activePage === 'silences' ? 'alerts' : 'silences')}
            className={`cursor-pointer self-end h-9 flex items-center pb-1.5 gap-1.5 px-4 text-xs font-medium transition-colors translate-y-px border border-b-0 rounded-t-compact ${
              activePage === 'silences'
                ? 'border-border bg-background text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/20'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-pill bg-info-solid ${activePage === 'silences' ? '' : 'opacity-80'}`} />
            Silences
            <span className="tabular-nums opacity-75">{alertCounts.silenceCount ?? 0}</span>
          </button>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* ── Desktop controls ── */}
        <div className="hidden md:flex items-center gap-1.5 self-stretch">
          {/* Cluster status */}
          <Popover
            open={clusterHoverOpen && clusters.length > 0}
            onOpenChange={setClusterHoverOpen}
            className="relative shrink-0 self-stretch flex items-center"
            panelClassName="absolute right-0 top-full z-50 min-w-[26rem] rounded-b-control border border-t-0 border-border bg-header shadow-lg"
            role="region"
            label="Connected instances"
            trigger={({ props }) => (
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-compact px-2 py-1 text-xs cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Instances ${healthyCount}/${clusters.length}`}
                {...props}
              >
                <div className={`h-2 w-2 rounded-pill ${healthyCount === clusters.length ? 'bg-success-solid' : 'bg-critical-solid'}`} />
                <span className="text-muted-foreground tabular-nums">{healthyCount}/{clusters.length}</span>
              </button>
            )}
          >
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border">Connected Instances</div>
            {clusters.map((c) => (
              <div
                key={c.name}
                className={`px-3 py-2 border-b border-border last:border-0 ${!c.healthy ? 'bg-critical-soft' : ''}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="relative flex items-center gap-2">
                    {c.healthy ? (
                      <div className="h-2 w-2 rounded-pill shrink-0 bg-success-solid" />
                    ) : (
                      <div className="relative shrink-0">
                        <div className="h-2.5 w-2.5 rounded-pill bg-critical-solid" />
                        <div className="absolute inset-0 rounded-pill bg-critical-solid animate-ping opacity-75" />
                      </div>
                    )}
                    <div
                      className="relative"
                      onBlur={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setClusterFilterOpen(null)
                      }}
                    >
                      <button
                        className="rounded-compact text-xs font-medium text-foreground hover:text-link cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onMouseEnter={() => setClusterFilterOpen(c.name)}
                        onMouseLeave={() => setClusterFilterOpen(null)}
                        onFocus={() => setClusterFilterOpen(c.name)}
                        onClick={() => {
                          addLabelMatcher({ name: '@cluster', operator: '=', value: c.name })
                          setClusterHoverOpen(false)
                        }}
                      >
                        {c.name}
                      </button>
                      {clusterFilterOpen === c.name && (
                        <div
                          className="absolute left-0 top-full mt-0.5 z-60 rounded-compact border border-border bg-popover shadow-md text-[11px]"
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
                              <span className="font-mono text-link">{op}</span>
                              <span className="font-medium text-foreground">{c.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {!c.healthy && (
                      <span className="rounded-compact bg-critical-soft px-1 py-0.5 text-[10px] font-semibold text-critical-fg uppercase tracking-wide">DOWN</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{c.alertCount} Alerts</span>
                </div>
                {c.members && c.members.length > 0 ? (
                  <div className="mt-1 pl-[1.375rem] space-y-0.5">
                    {c.members.map((m) => (
                      <div key={m.name} className="flex items-center gap-1.5 text-[10px]">
                        <div className={`h-1.5 w-1.5 rounded-pill shrink-0 ${m.healthy ? 'bg-success-solid' : 'bg-critical-solid'}`} />
                        <span className="break-all text-muted-foreground">{m.url}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1 pl-[1.375rem] text-[10px] text-muted-foreground break-all">{c.alertmanagerUrl}</div>
                )}
              </div>
            ))}
          </Popover>

          {/* WS status */}
          <WsStatus connected={wsConnected} />

          {/* Refresh — custom docked popover (not the generic Tooltip) so it matches
              the flush, header-colored look of the other header popovers. */}
          <Popover
            open={refreshTooltipOpen}
            onOpenChange={setRefreshTooltipOpen}
            className="relative shrink-0 self-stretch flex items-center"
            panelClassName="absolute right-0 top-full z-50 w-72 rounded-b-control border border-t-0 border-border bg-header px-3 py-2 text-xs leading-snug text-muted-foreground shadow-lg"
            role="tooltip"
            openOnFocus
            trigger={({ panelId, open }) => (
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleRefresh} aria-label="Refresh now" aria-describedby={open ? panelId : undefined} disabled={refreshing}>
                <RefreshCw className={`h-4 w-4 ${isSpinning ? 'animate-spin' : ''}`} />
              </Button>
            )}
          >
            {refreshTooltipText}
          </Popover>
          <div className="w-px h-5 bg-border shrink-0 mx-0.5" />

          {/* Info — Jarvis logo, version, copyright. Opens on hover, like cluster status above. */}
          <Popover
            open={infoOpen}
            onOpenChange={setInfoOpen}
            className="relative shrink-0 self-stretch flex items-center"
            panelClassName="absolute right-0 top-full z-50 w-56 rounded-b-control border border-t-0 border-border bg-header shadow-lg"
            trigger={({ props }) => (
              <button
                className="flex items-center justify-center h-8 w-8 rounded-compact cursor-pointer text-foreground hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="About Jarvis"
                data-testid="info-menu"
                {...props}
              >
                <Info className="h-4 w-4" />
              </button>
            )}
          >
            <InfoColophon version={version} />
          </Popover>

          {/* User menu — always present (Grafana-style): avatar when authenticated,
              generic icon otherwise. Settings + theme live here regardless of auth
              state; Login/Logout are added on top depending on it. Opens on hover. */}
          <Popover
            open={userMenuOpen}
            onOpenChange={setUserMenuOpen}
            className="relative shrink-0 self-stretch flex items-center"
            panelClassName="absolute right-0 top-full z-50 min-w-40 rounded-b-control border border-t-0 border-border bg-header shadow-lg"
            panelProps={{ 'data-testid': 'user-menu-panel' }}
            trigger={({ props }) => (
              <button
                className="flex items-center justify-center h-8 w-8 rounded-compact cursor-pointer text-foreground hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="User menu"
                                data-testid="user-menu"
                {...props}
              >
                {isAuthenticated && user ? <Avatar name={user.username} className="h-6 w-6" /> : <CircleUserRound className="h-5 w-5" />}
              </button>
            )}
          >
            {isAuthenticated && user && (user.provider === 'oidc' ? (
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-left text-foreground hover:bg-accent/60 cursor-pointer border-b border-border"
                data-testid="account-menu"
                aria-label={`Account of ${user.username}`}
                onClick={() => { setUserMenuOpen(false); setAccountOpen(true) }}
              >
                <UserRound className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{user.username}</span>
              </button>
            ) : (
              <div className="px-3 py-2 text-xs font-medium text-foreground border-b border-border">{user.username}</div>
            ))}
            {isAuthenticated && user && user.role === 'admin' && (
              <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-accent/60 cursor-pointer border-b border-border" onClick={() => { setUserMenuOpen(false); setAdminOpen(true) }}>
                <Shield className="h-3.5 w-3.5" />Administration
              </button>
            )}
            <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-accent/60 cursor-pointer" onClick={() => { setUserMenuOpen(false); setSettingsVisibility(true) }}>
              <Settings className="h-3.5 w-3.5" />Settings
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-accent/60 cursor-pointer"
              onClick={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
            >
              {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            {isAuthenticated && user ? (
              <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-accent/60 cursor-pointer border-t border-border" onClick={() => { setUserMenuOpen(false); logout() }}>
                <LogOut className="h-3.5 w-3.5" />Logout
              </button>
            ) : providerInfo !== null && providerInfo.mode !== 'none' ? (
              <button data-testid="login-button" className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-accent/60 cursor-pointer border-t border-border" onClick={() => { setUserMenuOpen(false); void requestLogin() }}>
                <LogIn className="h-3.5 w-3.5" />Login
              </button>
            ) : null}
          </Popover>

          <Button size="sm" onClick={() => setSilenceFormOpen(true)} className="h-7 text-xs shrink-0">
            <Plus className="mr-1 h-3.5 w-3.5" />
            Create silence
          </Button>
        </div>

        {/* ── Mobile: WS status + hamburger ── */}
        <div className="flex md:hidden items-center gap-1">
          <WsStatus connected={wsConnected} />
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setMenuOpen((v) => !v)} aria-label="Toggle menu" aria-expanded={menuOpen}>
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* ── Mobile hamburger panel ── */}
      {menuOpen && (
        <div className="md:hidden border-t border-border px-3 py-3 space-y-3">
          <div className="flex items-center gap-1 flex-wrap">
            <div className="flex-1" />
            <div className="flex items-center gap-1.5 px-2 text-xs cursor-pointer select-none" aria-label={`Instances ${healthyCount}/${clusters.length}`}>
              <div className={`h-2 w-2 rounded-pill ${healthyCount === clusters.length ? 'bg-success-solid' : 'bg-critical-solid'}`} />
              <span className="text-muted-foreground tabular-nums">{healthyCount}/{clusters.length}</span>
            </div>
            <Tooltip content={refreshTooltipText} side="bottom">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleRefresh} aria-label="Refresh now" disabled={refreshing}>
                <RefreshCw className={`h-4 w-4 ${isSpinning ? 'animate-spin' : ''}`} />
              </Button>
            </Tooltip>
            <Button size="sm" onClick={() => { setSilenceFormOpen(true); setMenuOpen(false) }} className="h-7 text-xs">
              <Plus className="mr-1 h-3.5 w-3.5" />Create silence
            </Button>
            <button
              className="flex items-center justify-center h-8 w-8 rounded-compact cursor-pointer text-foreground hover:bg-accent/60"
              onClick={() => setInfoOpen((v) => !v)}
              aria-expanded={infoOpen}
              aria-label="About Jarvis"
              data-testid="info-menu"
            >
              <Info className="h-4 w-4" />
            </button>
            <button
              className="flex items-center justify-center h-8 w-8 rounded-compact cursor-pointer text-foreground hover:bg-accent/60"
              onClick={() => setUserMenuOpen((v) => !v)}
              aria-expanded={userMenuOpen}
              aria-label="User menu"
              data-testid="user-menu"
            >
              {isAuthenticated && user ? <Avatar name={user.username} className="h-6 w-6" /> : <CircleUserRound className="h-5 w-5" />}
            </button>
          </div>

          {/* Info expanded (mobile) */}
          {infoOpen && (
            <div className="border border-border rounded-control bg-card">
              <InfoColophon version={version} />
            </div>
          )}

          {/* User menu expanded (mobile) */}
          {userMenuOpen && (
            <div className="border border-border rounded-control bg-card">
              {isAuthenticated && user && (user.provider === 'oidc' ? (
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-left text-foreground hover:bg-accent/60 cursor-pointer border-b border-border"
                  data-testid="account-menu"
                  aria-label={`Account of ${user.username}`}
                  onClick={() => { setUserMenuOpen(false); setAccountOpen(true); setMenuOpen(false) }}
                >
                  <UserRound className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{user.username}</span>
                </button>
              ) : (
                <div className="px-3 py-2 text-xs font-medium text-foreground border-b border-border">{user.username}</div>
              ))}
              {isAuthenticated && user && user.role === 'admin' && (
                <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-accent/60 cursor-pointer border-b border-border" onClick={() => { setUserMenuOpen(false); setAdminOpen(true); setMenuOpen(false) }}>
                  <Shield className="h-3.5 w-3.5" />Administration
                </button>
              )}
              <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-accent/60 cursor-pointer" onClick={() => { setUserMenuOpen(false); setSettingsVisibility(true); setMenuOpen(false) }}>
                <Settings className="h-3.5 w-3.5" />Settings
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-accent/60 cursor-pointer"
                onClick={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
              >
                {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>
              {isAuthenticated && user ? (
                <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-accent/60 cursor-pointer border-t border-border" onClick={() => { setUserMenuOpen(false); logout(); setMenuOpen(false) }}>
                  <LogOut className="h-3.5 w-3.5" />Logout
                </button>
              ) : providerInfo !== null && providerInfo.mode !== 'none' ? (
                <button data-testid="login-button" className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-accent/60 cursor-pointer border-t border-border" onClick={() => { setUserMenuOpen(false); void requestLogin(); setMenuOpen(false) }}>
                  <LogIn className="h-3.5 w-3.5" />Login
                </button>
              ) : null}
            </div>
          )}
        </div>
      )}

    </header>


    <Sheet open={silenceFormOpen} onClose={() => setSilenceFormOpen(false)} className="sm:max-w-[760px] lg:max-w-[760px]" ariaLabel="Create silence">
      <div className="border-b border-border px-5 pt-10 pb-0">
        <div className="flex gap-1 -mb-px">
          <button
            onClick={() => setSilenceActiveTab('silence')}
            className={`px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
              silenceActiveTab === 'silence'
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Create Silence
          </button>
          <button
            onClick={() => setSilenceActiveTab('templates')}
            className={`px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
              silenceActiveTab === 'templates'
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Templates
          </button>
        </div>
      </div>
      {silenceActiveTab === 'silence' && (
        <div className="p-5">
          <SilenceForm
            availableClusters={clusters.map((c) => c.name).length > 0 ? clusters.map((c) => c.name) : ['default']}
            onSuccess={() => setSilenceFormOpen(false)}
            onCancel={() => setSilenceFormOpen(false)}
          />
        </div>
      )}
      {silenceActiveTab === 'templates' && <SilenceTemplateTab />}
    </Sheet>

    <SettingsSheet
      open={settingsOpen}
      onClose={() => setSettingsVisibility(false)}
    />

    {user?.provider === 'oidc' && (
      <AccountSheet open={accountOpen} onClose={() => setAccountOpen(false)} user={user} />
    )}

    <Sheet open={adminOpen} onClose={() => setAdminOpen(false)} ariaLabel="User Management">
      <div className="p-5 pt-10">
        <h2 className="mb-4 text-base font-semibold">User Management</h2>
        <UserManagement />
      </div>
    </Sheet>
    </>
  )
}
