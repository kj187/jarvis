import { useState } from 'react'
import { Plus, Loader2 } from 'lucide-react'
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
  const { data: silences = [], isLoading, isFetching } = useSilences()
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
          {isFetching && !isLoading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowExpired((v) => !v)}
            className="text-xs"
          >
            {showExpired ? 'Hide expired' : 'Show expired'}
          </Button>
          <Button size="sm" onClick={handleCreateNew}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Create silence
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && sorted.length === 0 && (
        <p className="text-sm text-muted-foreground">No active silences.</p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map((s) => (
          <SilenceCard
            key={`${s.clusterName}:${s.id}`}
            silence={s}
            alerts={alerts}
            onEdit={handleEdit}
            onDelete={handleDelete}
            isDeleting={deleteMutation.isPending && deleteMutation.variables?.id === s.id}
          />
        ))}
      </div>

      {/* Silence form sheet */}
      <Sheet open={formOpen} onClose={() => setFormOpen(false)} className="sm:max-w-[760px] lg:max-w-[760px]">
        <div className="p-5 pt-10">
          <h2 className="mb-4 text-base font-semibold">
            {!editSilence ? 'Create silence' : editSilence.status.state === 'expired' ? 'Recreate silence' : 'Edit silence'}
          </h2>
          <SilenceForm
            availableClusters={clusterNames.length > 0 ? clusterNames : ['default']}
            prefillSilence={editSilence ?? undefined}
            isRecreate={editSilence?.status.state === 'expired'}
            onSuccess={() => setFormOpen(false)}
            onCancel={() => setFormOpen(false)}
          />
        </div>
      </Sheet>
    </div>
  )
}
