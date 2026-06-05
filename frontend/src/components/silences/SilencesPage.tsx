import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { SilenceCard } from './SilenceCard'
import { SilenceForm } from './SilenceForm'
import { useSilences, useDeleteSilence } from '@/hooks/useSilences'
import { useAlerts } from '@/hooks/useAlerts'
import { useQuery } from '@tanstack/react-query'
import { fetchClusters } from '@/api/client'
import type { Silence } from '@/types'

export function SilencesPage() {
  const { data: silences = [], isLoading } = useSilences()
  const { data: alerts = [] } = useAlerts()
  const { data: clusters = [] } = useQuery({
    queryKey: ['clusters'],
    queryFn: fetchClusters,
  })
  const deleteMutation = useDeleteSilence()

  const [showExpired, setShowExpired] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editSilence, setEditSilence] = useState<Silence | null>(null)

  const clusterNames = clusters.map((c) => c.name)

  const filtered = showExpired
    ? silences
    : silences.filter((s) => s.status.state !== 'expired')

  const sorted = [...filtered].sort((a, b) => {
    const order = { active: 0, pending: 1, expired: 2 }
    return (order[a.status.state] ?? 3) - (order[b.status.state] ?? 3)
  })

  function handleDelete(silence: Silence) {
    deleteMutation.mutate({
      id: silence.id,
      cluster: silence.clusterName,
    })
  }

  function handleEdit(silence: Silence) {
    setEditSilence(silence)
    setFormOpen(true)
  }

  function handleCreateNew() {
    setEditSilence(null)
    setFormOpen(true)
  }

  return (
    <div className="px-4 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold">Silences</h1>
          <span className="text-xs text-muted-foreground">{sorted.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowExpired((v) => !v)}
            className="text-xs"
          >
            {showExpired ? 'Expired ausblenden' : 'Expired anzeigen'}
          </Button>
          <Button size="sm" onClick={handleCreateNew}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Silence erstellen
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Laden…</p>}

      {!isLoading && sorted.length === 0 && (
        <p className="text-sm text-muted-foreground">Keine aktiven Silences.</p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map((s) => (
          <SilenceCard
            key={`${s.clusterName}:${s.id}`}
            silence={s}
            alerts={alerts}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {/* Silence form sheet */}
      <Sheet open={formOpen} onClose={() => setFormOpen(false)}>
        <div className="p-5 pt-10">
          <h2 className="mb-4 text-base font-semibold">
            {editSilence ? 'Silence bearbeiten' : 'Silence erstellen'}
          </h2>
          <SilenceForm
            clusters={clusterNames.length > 0 ? clusterNames : ['default']}
            prefillSilence={editSilence ?? undefined}
            onSuccess={() => setFormOpen(false)}
            onCancel={() => setFormOpen(false)}
          />
        </div>
      </Sheet>
    </div>
  )
}
