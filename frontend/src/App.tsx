import { useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { AlertsPage } from '@/components/alerts/AlertsPage'
import { SetupPage } from '@/components/auth/SetupPage'
import { LoginPage } from '@/components/auth/LoginPage'
import { NoAuthNotice } from '@/components/auth/NoAuthNotice'
import { useSettingsStore } from '@/store/useSettingsStore'
import { useUIStore, VIEW_MODE_KEY } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'

export default function App() {
  const defaultFilters = useSettingsStore((s) => s.defaultFilters)
  const defaultViewMode = useSettingsStore((s) => s.defaultViewMode)
  const syncLockedMatchers = useUIStore((s) => s.syncLockedMatchers)
  const setViewMode = useUIStore((s) => s.setViewMode)
  const providerInfo = useAuthStore((s) => s.providerInfo)
  const setupRequired = useAuthStore((s) => s.setupRequired)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isLoading = useAuthStore((s) => s.isLoading)

  // Sync settings default filters → locked matchers in uiStore whenever they change
  useEffect(() => {
    syncLockedMatchers(defaultFilters)
  }, [defaultFilters, syncLockedMatchers])

  // Apply settings default only if there is no previously selected view mode.
  useEffect(() => {
    const savedViewMode = window.localStorage.getItem(VIEW_MODE_KEY)
    if (savedViewMode === 'card' || savedViewMode === 'list') return
    setViewMode(defaultViewMode)
  }, [defaultViewMode, setViewMode])

  // First-run setup page: backend redirects to /setup in prod; setupRequired flag handles dev mode.
  if (setupRequired || window.location.pathname === '/setup') {
    return <SetupPage />
  }

  // full_protect: block all content until authenticated.
  if (!isLoading && providerInfo?.authMode === 'full_protect' && !isAuthenticated) {
    return <LoginPage />
  }

  return (
    <div className="min-h-screen bg-background">
      {providerInfo?.mode === 'none' && <NoAuthNotice />}
      <Header />
      <main className="py-4">
        <AlertsPage />
      </main>
    </div>
  )
}
