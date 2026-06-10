import { useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { AlertsPage } from '@/components/alerts/AlertsPage'
import { useSettingsStore } from '@/store/useSettingsStore'
import { useUIStore } from '@/store/uiStore'

export default function App() {
  const defaultFilters = useSettingsStore((s) => s.defaultFilters)
  const defaultViewMode = useSettingsStore((s) => s.defaultViewMode)
  const syncLockedMatchers = useUIStore((s) => s.syncLockedMatchers)
  const setViewMode = useUIStore((s) => s.setViewMode)

  // Sync settings default filters → locked matchers in uiStore whenever they change
  useEffect(() => {
    syncLockedMatchers(defaultFilters)
  }, [defaultFilters, syncLockedMatchers])

  // Apply defaultViewMode from settings on mount and whenever it changes
  useEffect(() => {
    setViewMode(defaultViewMode)
  }, [defaultViewMode, setViewMode])

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="py-4">
        <AlertsPage />
      </main>
    </div>
  )
}
