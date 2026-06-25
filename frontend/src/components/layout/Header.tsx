import { useRef, useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Wifi, WifiOff, RefreshCw, Play, Pause, Plus, Settings, LogIn, LogOut, UserCheck, Shield, Sun, Moon, Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { SilenceForm } from '@/components/silences/SilenceForm'
import { SilenceTemplateTab } from '@/components/silences/SilenceTemplateTab'
import { SettingsSheet } from '@/components/settings/SettingsSheet'
import { LoginModal } from '@/components/auth/LoginModal'
import { UserManagement } from '@/components/admin/UserManagement'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { useQuery } from '@tanstack/react-query'
import { fetchClusters } from '@/api/client'

// ── Header ────────────────────────────────────────────────────────────────────

export function Header() {
  const {
    activePage,
    setActivePage,
    wsConnected,
    pollingPaused,
    setPollingPaused,
    filters,
    setFilter,
    addLabelMatcher,
    alertCounts,
  } = useUIStore()

  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const [clusterHoverOpen, setClusterHoverOpen] = useState(false)
  const [clusterFilterOpen, setClusterFilterOpen] = useState<string | null>(null)
  const clusterCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function openClusterPopover() {
    if (clusterCloseTimer.current) clearTimeout(clusterCloseTimer.current)
    setClusterHoverOpen(true)
  }
  function closeClusterPopover() {
    clusterCloseTimer.current = setTimeout(() => setClusterHoverOpen(false), 120)
  }

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
  const [silenceActiveTab, setSilenceActiveTab] = useState<'silence' | 'templates'>('silence')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loginModalOpen, setLoginModalOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const { user, isAuthenticated, logout, providerInfo } = useAuthStore()
  const theme = useSettingsStore((s) => s.theme)
  const updateSettings = useSettingsStore((s) => s.update)

  const healthyCount = clusters.filter((c) => c.healthy).length

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

        {/* Nav tabs — always left */}
        <div className="flex self-stretch shrink-0" role="group" aria-label="Navigation">
          <button
            onClick={() => { setActivePage('alerts'); if (!filters.state) setFilter('state', 'active') }}
            className={`cursor-pointer self-end h-9 flex items-center pb-1.5 gap-1.5 px-4 text-xs font-medium transition-colors translate-y-px border border-b-0 rounded-t-sm ${
              activePage === 'alerts'
                ? 'border-border bg-background text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/20'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${activePage === 'alerts' ? 'bg-orange-500' : 'bg-orange-400'}`} />
            Alerts
            <span className="tabular-nums opacity-75">{alertCounts.byState?.active ?? 0}</span>
          </button>
          <button
            onClick={() => setActivePage(activePage === 'silences' ? 'alerts' : 'silences')}
            className={`cursor-pointer self-end h-9 flex items-center pb-1.5 gap-1.5 px-4 text-xs font-medium transition-colors translate-y-px border border-b-0 rounded-t-sm ${
              activePage === 'silences'
                ? 'border-border bg-background text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/20'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${activePage === 'silences' ? 'bg-blue-500' : 'bg-blue-400'}`} />
            Silences
            <span className="tabular-nums opacity-75">{alertCounts.silenceCount ?? 0}</span>
          </button>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* ── Desktop controls ── */}
        <div className="hidden md:flex items-center gap-1.5 self-stretch">
          {/* Cluster status */}
          <div
            className="relative shrink-0"
            onMouseEnter={openClusterPopover}
            onMouseLeave={closeClusterPopover}
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
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[26rem] rounded-md border border-border bg-card shadow-lg" role="tooltip" onMouseEnter={openClusterPopover} onMouseLeave={closeClusterPopover}>
                <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border">Connected Instances</div>
                {clusters.map((c) => (
                  <div
                    key={c.name}
                    className={`px-3 py-2 border-b border-border last:border-0 ${!c.healthy ? (theme === 'light' ? 'bg-red-50' : 'bg-red-950/30') : ''}`}
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
          <div className="w-px h-5 bg-border shrink-0 mx-0.5" />
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
                data-testid="user-menu"
                title={user.username}
              >
                <UserCheck className="h-4 w-4" />
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
            <Button variant="ghost" size="icon" data-testid="login-button" className="h-8 w-8 shrink-0" onClick={() => setLoginModalOpen(true)} title="Login" aria-label="Login">
              <LogIn className="h-4 w-4" />
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

      {/* ── Mobile hamburger panel ── */}
      {menuOpen && (
        <div className="md:hidden border-t border-border px-3 py-3 space-y-3">
          <div className="flex items-center gap-1 flex-wrap">
            <div className="flex-1" />
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
                <UserCheck className="h-4 w-4" />
              </button>
            ) : providerInfo !== null && providerInfo.mode !== 'none' ? (
              <button className="flex items-center justify-center h-8 w-8 rounded cursor-pointer text-muted-foreground hover:text-foreground hover:bg-accent/60" onClick={() => { setLoginModalOpen(true); setMenuOpen(false) }} title="Login" aria-label="Login">
                <LogIn className="h-4 w-4" />
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
      onClose={() => setSettingsOpen(false)}
    />

    <LoginModal
      open={loginModalOpen}
      onSuccess={() => setLoginModalOpen(false)}
      onClose={() => setLoginModalOpen(false)}
    />

    <Sheet open={adminOpen} onClose={() => setAdminOpen(false)} ariaLabel="User Management">
      <div className="p-5 pt-10">
        <h2 className="mb-4 text-base font-semibold">User Management</h2>
        <UserManagement />
      </div>
    </Sheet>
    </>
  )
}
