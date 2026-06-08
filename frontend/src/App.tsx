import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { AlertsPage } from '@/components/alerts/AlertsPage'

export default function App() {
  const [currentPage, setCurrentPage] = useState('alerts')

  return (
    <div className="min-h-screen bg-background">
      <Header
        currentPage={currentPage}
        onNavigate={setCurrentPage}
      />
      <main className="py-4">
        {currentPage === 'alerts' && <AlertsPage />}
      </main>
    </div>
  )
}
