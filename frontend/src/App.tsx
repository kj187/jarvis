import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { AlertsPage } from '@/components/alerts/AlertsPage'
import { SilencesPage } from '@/components/silences/SilencesPage'

type Page = 'alerts' | 'silences'

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('alerts')

  return (
    <div className="min-h-screen bg-background">
      <Header
        currentPage={currentPage}
        onNavigate={(page) => setCurrentPage(page as Page)}
      />
      <main className="py-4">
        {currentPage === 'alerts' && <AlertsPage />}
        {currentPage === 'silences' && <SilencesPage />}
      </main>
    </div>
  )
}
