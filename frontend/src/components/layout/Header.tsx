import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Wifi, WifiOff, RefreshCw, Play, Pause, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ViewToggle } from '@/components/alerts/ViewToggle'
import { useUIStore } from '@/store/uiStore'
import { useQuery } from '@tanstack/react-query'
import { fetchClusters } from '@/api/client'

export function Header({ currentPage, onNavigate }: { currentPage: string; onNavigate: (page: string) => void }) {
  const {
    viewMode,
    setViewMode,
    wsConnected,
    pollingPaused,
    setPollingPaused,
    filters,
    setFilter,
  } = useUIStore()

  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const { data: clusters = [] } = useQuery({
    queryKey: ['clusters'],
    queryFn: fetchClusters,
    refetchInterval: 30_000,
  })

  const healthyCount = clusters.filter((c) => c.healthy).length

  async function handleRefresh() {
    setRefreshing(true)
    await qc.invalidateQueries({ queryKey: ['alerts'] })
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

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Logo / Nav */}
        <div className="flex items-center gap-4 mr-auto">
          <span className="text-lg font-bold tracking-tight">Jarvis</span>

          <nav className="flex gap-2">
            <button
              onClick={() => onNavigate('alerts')}
              className={`cursor-pointer rounded px-2.5 py-1 text-sm transition-colors ${
                currentPage === 'alerts'
                  ? 'bg-accent font-semibold text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Alerts
            </button>
            <button
              onClick={() => onNavigate('silences')}
              className={`cursor-pointer rounded px-2.5 py-1 text-sm transition-colors ${
                currentPage === 'silences'
                  ? 'bg-accent font-semibold text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Silences
            </button>
          </nav>
        </div>

        {/* Search */}
        {searchOpen && (
          <Input
            ref={searchRef}
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
            onKeyDown={handleSearchKey}
            placeholder="Suche…"
            className="h-8 w-40 text-xs"
          />
        )}

        {/* Cluster status */}
        <div
          className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs"
          title={clusters.map((c) => `${c.name}: ${c.healthy ? 'OK' : 'DOWN'} (${c.alertCount})`).join('\n')}
        >
          <div className={`h-2 w-2 rounded-full ${healthyCount === clusters.length ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-muted-foreground">
            Cluster {healthyCount}/{clusters.length}
          </span>
        </div>

        {/* WS status */}
        <div className="text-muted-foreground" title={wsConnected ? 'WebSocket verbunden' : 'WebSocket getrennt'}>
          {wsConnected ? <Wifi className="h-4 w-4 text-green-500" /> : <WifiOff className="h-4 w-4 text-red-500" />}
        </div>

        {/* View toggle (only on alerts page) */}
        {currentPage === 'alerts' && (
          <ViewToggle value={viewMode} onChange={setViewMode} />
        )}

        {/* Search toggle */}
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleSearch} title="Suche">
          {searchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
        </Button>

        {/* Polling controls */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setPollingPaused(!pollingPaused)}
          title={pollingPaused ? 'Polling fortsetzen' : 'Polling pausieren'}
        >
          {pollingPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleRefresh}
          title="Jetzt aktualisieren"
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>
    </header>
  )
}
