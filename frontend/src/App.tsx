import { Header } from '@/components/layout/Header'
import { AlertsPage } from '@/components/alerts/AlertsPage'

export default function App() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="py-4">
        <AlertsPage />
      </main>
    </div>
  )
}
