import { useState, useEffect } from 'react'
import { Plus, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SilenceCard } from './SilenceCard'
import { SilenceForm } from './SilenceForm'
import { SilenceExpireModal } from './SilenceExpireModal'
import { SilenceTemplateTab } from './SilenceTemplateTab'
import { useSilences, useDeleteSilence } from '@/hooks/useSilences'
import { useAlerts } from '@/hooks/useAlerts'
import { useQuery } from '@tanstack/react-query'
import { fetchClusters } from '@/api/client'
import type { Silence } from '@/types'

type SheetTab = 'silence' | 'templates'

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
  const [activeTab, setActiveTab] = useState<SheetTab>('silence')
  const [editSilence, setEditSilence] = useState<Silence | null>(null)
  const [expireTarget, setExpireTarget] = useState<Silence | null>(null)

  // Handle ESC key for sheet
  useEffect(() => {
    if (!formOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFormOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [formOpen])

  // Handle body overflow
  useEffect(() => {
    if (!formOpen) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [formOpen])

  const clusterNames = clusters.map((c) => c.name)

  const filtered = showExpired
    ? silences
    : silences.filter((s) => s.status.state !== 'expired')

  const sorted = [...filtered].sort((a, b) => {
    const order = { active: 0, pending: 1, expired: 2 }
    return (order[a.status.state] ?? 3) - (order[b.status.state] ?? 3)
  })

  function handleExpireConfirm() {
    if (!expireTarget) return
    deleteMutation.mutate(
      { id: expireTarget.id, cluster: expireTarget.clusterName },
      { onSettled: () => setExpireTarget(null) },
    )
  }

  function handleEdit(silence: Silence) {
    setEditSilence(silence)
    setActiveTab('silence')
    setFormOpen(true)
  }

  function handleCreateNew() {
    setEditSilence(null)
    setActiveTab('silence')
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
            onExpire={setExpireTarget}
            isDeleting={deleteMutation.isPending && deleteMutation.variables?.id === s.id}
          />
        ))}
      </div>

      <SilenceExpireModal
        silences={expireTarget ? [expireTarget] : []}
        allAlerts={alerts}
        open={expireTarget !== null}
        onConfirm={handleExpireConfirm}
        onCancel={() => setExpireTarget(null)}
        isPending={deleteMutation.isPending}
      />

      {/* Silence form sheet with tabs */}
      {formOpen && (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-card shadow-xl sm:max-w-[760px] lg:max-w-[760px]">
          {/* Close button */}
          <button
            onClick={() => setFormOpen(false)}
            className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer z-10"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Tab Navigation */}
          <div className="border-b border-border px-5 pt-6 pb-0">
            <div className="flex gap-1 -mb-px">
              <button
                onClick={() => setActiveTab('silence')}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'silence'
                    ? 'border-b-2 border-primary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Create Silence
              </button>
              <button
                onClick={() => setActiveTab('templates')}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'templates'
                    ? 'border-b-2 border-primary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Templates
              </button>
            </div>
          </div>

          {/* Tab Content */}
          <div className="overflow-y-auto flex-1">
            {activeTab === 'silence' && (
              <div className="p-5">
                <SilenceForm
                  availableClusters={clusterNames.length > 0 ? clusterNames : ['default']}
                  prefillSilence={editSilence ?? undefined}
                  isRecreate={editSilence?.status.state === 'expired'}
                  onSuccess={() => setFormOpen(false)}
                  onCancel={() => setFormOpen(false)}
                />
              </div>
            )}

            {activeTab === 'templates' && <SilenceTemplateTab />}
          </div>
        </div>
      )}

      {/* Backdrop */}
      {formOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setFormOpen(false)}
          aria-hidden="true"
        />
      )}
    </div>
  )
}
