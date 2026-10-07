import { useEffect, useLayoutEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { AlertsPage } from '@/components/alerts/AlertsPage'
import { SilencesPage } from '@/components/silences/SilencesPage'
import { SetupPage } from '@/components/auth/SetupPage'
import { Button } from '@/components/ui/button'
import { LoginPage } from '@/components/auth/LoginPage'
import { LoginPrompt } from '@/components/auth/LoginPrompt'
import { NoAuthNotice } from '@/components/auth/NoAuthNotice'
import { useSettingsStore } from '@/store/useSettingsStore'
import { useUIStore, VIEW_MODE_KEY } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useAlertCounts } from '@/hooks/useAlertCounts'
import { useSettingsSync } from '@/hooks/useSettingsSync'

export default function App() {
  useWebSocket()
  useAlertCounts()
  useSettingsSync()

  const theme = useSettingsStore((s) => s.theme)
  const defaultViewMode = useSettingsStore((s) => s.defaultViewMode)
  const setViewMode = useUIStore((s) => s.setViewMode)
  const activePage = useUIStore((s) => s.activePage)
  const isFullscreen = useUIStore((s) => s.isFullscreen)
  const providerInfo = useAuthStore((s) => s.providerInfo)
  const setupRequired = useAuthStore((s) => s.setupRequired)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isLoading = useAuthStore((s) => s.isLoading)
  const sessionExpired = useAuthStore((s) => s.sessionExpired)
  const authError = useAuthStore((s) => s.authError)
  const hydrate = useAuthStore((s) => s.hydrate)

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

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

  // The auth state could not be read (backend unreachable or 5xx): say so and
  // offer Retry instead of showing a login screen to someone who may be signed in.
  if (authError && !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div role="alert" data-testid="auth-error" className="w-full max-w-sm rounded-surface border border-border bg-card p-8 space-y-4 text-center">
          <h1 className="text-xl font-bold tracking-tight">Jarvis</h1>
          <p className="text-sm text-muted-foreground">
            The sign-in state could not be loaded. The server may be temporarily unavailable.
          </p>
          <Button onClick={() => void hydrate()} disabled={isLoading}>
            {isLoading ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      </div>
    )
  }

  // full_protect: block all content until authenticated. A session that expired
  // while the app was open keeps the page mounted instead (LoginPrompt covers it),
  // so open dialogs and half-filled forms survive the re-login.
  if (!isLoading && providerInfo?.authMode === 'full_protect' && !isAuthenticated && !sessionExpired) {
    return <LoginPage />
  }

  return (
    <div className="min-h-screen bg-background">
      {providerInfo?.mode === 'none' && <NoAuthNotice />}
      {!isFullscreen && <Header />}
      <main className={isFullscreen ? '' : 'py-4'}>
        {activePage === 'silences' ? <SilencesPage /> : <AlertsPage />}
      </main>
      <LoginPrompt />
    </div>
  )
}
