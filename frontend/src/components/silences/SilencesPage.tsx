import { useState, useEffect } from 'react'
import { Loader2, X, ArrowUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SilenceCard } from './SilenceCard'
import { SilenceGroupCard } from './SilenceGroupCard'
import { SilenceListView } from './SilenceListView'
import { SilenceForm } from './SilenceForm'
import { SilenceExpireModal } from './SilenceExpireModal'
import { SilenceTemplateTab } from './SilenceTemplateTab'
import { ViewToggle } from '@/components/alerts/ViewToggle'
import { useSilences, useDeleteSilence } from '@/hooks/useSilences'
import { useAlerts } from '@/hooks/useAlerts'
import { useQuery } from '@tanstack/react-query'
import { fetchClusters } from '@/api/client'
import { useUIStore } from '@/store/uiStore'
import { MatcherChipsBar } from '@/components/layout/MatcherChipsBar'
import { filterSilences } from '@/lib/alertUtils'
import type { Silence } from '@/types'
import type { SilenceGroup } from './SilenceGroupCard'

type SheetTab = 'silence' | 'templates'
type SortBy = 'expires' | 'created'

function silenceGroupKey(s: Silence): string {
  const matchers = [...s.matchers]
    .sort((a, b) => a.name.localeCompare(b.name) || a.value.localeCompare(b.value))
    .map((m) => `${m.name}${m.isRegex ? (m.isEqual ? '=~' : '!~') : m.isEqual ? '=' : '!='} ${m.value}`)
    .join('|')
  return `${matchers}__${s.comment ?? ''}__${s.createdBy}__${s.endsAt}`
}

function buildGroups(silences: Silence[]): SilenceGroup[] {
  const map = new Map<string, Silence[]>()
  for (const s of silences) {
    const k = silenceGroupKey(s)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(s)
  }
  return Array.from(map.entries()).map(([key, sils]) => ({ key, silences: sils }))
}

export function SilencesPage() {
  const { data: silences = [], isLoading, isFetching } = useSilences()
  const { data: alerts = [] } = useAlerts()
  const { data: clusters = [] } = useQuery({
    queryKey: ['clusters'],
    queryFn: fetchClusters,
  })
  const deleteMutation = useDeleteSilence()

  const { silencesViewMode: viewMode, setSilencesViewMode, filters } = useUIStore()
  const [sortBy, setSortBy] = useState<SortBy>('expires')
  const [showExpired, setShowExpired] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<SheetTab>('silence')
  const [editSilence, setEditSilence] = useState<Silence | null>(null)
  const [editGroup, setEditGroup] = useState<Silence[]>([])
  const [expireTargets, setExpireTargets] = useState<Silence[]>([])

  useEffect(() => {
    if (!formOpen) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFormOpen(false) }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [formOpen])

  useEffect(() => {
    if (!formOpen) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [formOpen])

  const clusterNames = clusters.map((c) => c.name)

  const base = showExpired ? silences : silences.filter((s) => s.status.state !== 'expired')
  const filtered = filterSilences(base, filters.search, filters.labelMatchers)

  const sorted = [...filtered].sort((a, b) => {
    const stateOrder = { active: 0, pending: 1, expired: 2 }
    const stateDiff = (stateOrder[a.status.state] ?? 3) - (stateOrder[b.status.state] ?? 3)
    if (stateDiff !== 0) return stateDiff
    const dateA = sortBy === 'expires' ? new Date(a.endsAt).getTime() : new Date(a.startsAt).getTime()
    const dateB = sortBy === 'expires' ? new Date(b.endsAt).getTime() : new Date(b.startsAt).getTime()
    return dateA - dateB
  })

  const groups = buildGroups(sorted)

  const deletingIds: Set<string> = deleteMutation.isPending
    ? new Set(expireTargets.map((s) => s.id))
    : new Set()

  async function handleExpireConfirm() {
    if (expireTargets.length === 0) return
    for (const s of expireTargets) {
      await deleteMutation.mutateAsync({ id: s.id, cluster: s.clusterName })
    }
    setExpireTargets([])
  }

  function handleEdit(silence: Silence) {
    setEditSilence(silence)
    setEditGroup([])
    setActiveTab('silence')
    setFormOpen(true)
  }

  function handleEditGroup(silences: Silence[]) {
    setEditSilence(null)
    setEditGroup(silences)
    setActiveTab('silence')
    setFormOpen(true)
  }

  const isRecreate = editSilence
    ? editSilence.status.state === 'expired'
    : editGroup.length > 0 && editGroup.every((s) => s.status.state === 'expired')

  return (
    <div className="px-4 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <MatcherChipsBar allowAdd />
          {isFetching && !isLoading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Sort:</span>
            <div className="flex items-center rounded-md border border-border overflow-hidden">
              <button
                onClick={() => setSortBy('expires')}
                className={`cursor-pointer px-2.5 h-7 text-xs font-medium transition-colors ${
                  sortBy === 'expires' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Expires
              </button>
              <button
                onClick={() => setSortBy('created')}
                className={`cursor-pointer px-2.5 h-7 text-xs font-medium transition-colors ${
                  sortBy === 'created' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Created
              </button>
            </div>
          </div>
          <ViewToggle value={viewMode} onChange={setSilencesViewMode} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowExpired((v) => !v)}
            className="text-xs"
          >
            {showExpired ? 'Hide expired' : 'Show expired'}
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">No active silences.</p>
      )}

      {viewMode === 'card' ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) =>
            group.silences.length === 1 ? (
              <SilenceCard
                key={group.key}
                silence={group.silences[0]}
                alerts={alerts}
                onEdit={handleEdit}
                onExpire={(s) => setExpireTargets([s])}
                isDeleting={deletingIds.has(group.silences[0].id)}
              />
            ) : (
              <SilenceGroupCard
                key={group.key}
                group={group}
                alerts={alerts}
                onEditGroup={handleEditGroup}
                onExpireGroup={setExpireTargets}
                deletingIds={deletingIds}
              />
            ),
          )}
        </div>
      ) : (
        <SilenceListView
          groups={groups}
          alerts={alerts}
          onEditGroup={handleEditGroup}
          onExpireGroup={setExpireTargets}
          deletingIds={deletingIds}
        />
      )}

      <SilenceExpireModal
        silences={expireTargets}
        allAlerts={alerts}
        open={expireTargets.length > 0}
        onConfirm={handleExpireConfirm}
        onCancel={() => setExpireTargets([])}
        isPending={deleteMutation.isPending}
      />

      {formOpen && (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-card shadow-xl sm:max-w-[760px] lg:max-w-[760px]">
          <button
            onClick={() => { setFormOpen(false); setEditGroup([]) }}
            className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer z-10"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="border-b border-border px-5 pt-6 pb-0">
            <div className="flex gap-1 -mb-px">
              <button
                onClick={() => setActiveTab('silence')}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'silence' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {isRecreate ? 'Re-create Silence' : (editSilence || editGroup.length > 0) ? 'Edit Silence' : 'Create Silence'}
              </button>
              {!(editSilence || editGroup.length > 0) && (
                <button
                  onClick={() => setActiveTab('templates')}
                  className={`px-3 py-2 text-sm font-medium transition-colors ${
                    activeTab === 'templates' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Templates
                </button>
              )}
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {activeTab === 'silence' && (
              <div className="p-5">
                <SilenceForm
                  availableClusters={clusterNames.length > 0 ? clusterNames : ['default']}
                  prefillSilence={editSilence ?? undefined}
                  prefillGroup={editGroup.length > 0 ? editGroup : undefined}
                  isRecreate={isRecreate}
                  onSuccess={() => { setFormOpen(false); setEditGroup([]) }}
                  onCancel={() => { setFormOpen(false); setEditGroup([]) }}
                />
              </div>
            )}
            {activeTab === 'templates' && <SilenceTemplateTab />}
          </div>
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={() => { setFormOpen(false); setEditGroup([]) }} aria-hidden="true" />
      )}
    </div>
  )
}
