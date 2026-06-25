import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { ChevronDown, ChevronRight, Grip } from 'lucide-react'
import { AlertCard } from './AlertCard'
import { EmptyState } from './EmptyState'
import { Sheet } from '@/components/ui/sheet'
import { SilenceForm } from '@/components/silences/SilenceForm'
import { useQuery } from '@tanstack/react-query'
import { fetchClusters } from '@/api/client'
import type { EnrichedAlert, Silence } from '@/types'
import { getFilterableLabels, severityOrder } from '@/lib/alertUtils'
import { useSettingsStore } from '@/store/useSettingsStore'
import { useUIStore } from '@/store/uiStore'

interface AlertCardGridProps {
  alerts: EnrichedAlert[]
  silences: Silence[]
  onSelectAlert: (fingerprint: string) => void
  selectedFingerprint?: string | null
  resolvedMode?: boolean
}

interface CardGroup {
  alertname: string
  groupValue: string
  alerts: EnrichedAlert[]
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Critical',
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
  none: 'None',
}

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  error: 'bg-orange-500',
  warning: 'bg-yellow-500',
  info: 'bg-blue-500',
  none: 'bg-slate-500',
}

const PAGE_SIZE = 3

function useColumns(): number {
  const [cols, setCols] = useState(() => {
    const w = window.innerWidth
    if (w >= 1536) return 4
    if (w >= 1280) return 3
    if (w >= 640) return 2
    return 1
  })
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      if (w >= 1536) setCols(4)
      else if (w >= 1280) setCols(3)
      else if (w >= 640) setCols(2)
      else setCols(1)
    }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return cols
}

// Rough height estimate in pixels for bin-packing.
// Avoids DOM measurement; good enough for balanced distribution.
function estimateHeight(group: CardGroup, silences: Silence[]): number {
  const visibleEntries = Math.min(group.alerts.length, PAGE_SIZE)
  let h = 40 // card header
  for (let i = 0; i < visibleEntries; i++) {
    const alert = group.alerts[i]
    h += 20 // timestamp row
    // silence banner
    const silenced = alert.status.silencedBy.some((id) =>
      silences.find((s) => s.id === id && s.status.state !== 'expired'),
    )
    if (silenced) h += 48
    const labelCount = Object.keys(alert.labels).length
    h += Math.ceil(labelCount / 4) * 22 // label chips (wrap estimate)
    if (alert.annotations['summary']) h += 18
    if (alert.annotations['description']) h += 18
    h += 8 // entry padding + gap
  }
  if (group.alerts.length > PAGE_SIZE) h += 44 // pagination bar
  return h
}

// Greedy bin-packing that preserves incoming order.
function distributeColumns(groups: CardGroup[], silences: Silence[], numCols: number): CardGroup[][] {
  const cols: CardGroup[][] = Array.from({ length: numCols }, () => [])
  const heights = Array(numCols).fill(0)
  for (const group of groups) {
    let minIdx = 0
    for (let i = 1; i < numCols; i++) {
      if (heights[i] < heights[minIdx]) minIdx = i
    }
    cols[minIdx].push(group)
    heights[minIdx] += estimateHeight(group, silences)
  }
  return cols
}

function loadStoredArray(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

export function AlertCardGrid({
  alerts,
  silences,
  onSelectAlert,
  selectedFingerprint,
  resolvedMode,
}: AlertCardGridProps) {
  const numCols = useColumns()
  const groupByLabel = useSettingsStore((s) => s.groupByLabel)
  const isFullscreen = useUIStore((s) => s.isFullscreen)
  const collapsedStorageKey = `jarvis-card-collapsed-sections:${groupByLabel}`
  const orderStorageKey = `jarvis-card-section-order:${groupByLabel}`
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [sectionOrder, setSectionOrder] = useState<string[]>([])
  const [draggedSection, setDraggedSection] = useState<string | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})
  const dragGhostRef = useRef<HTMLElement | null>(null)
  const dragOverIndexRef = useRef<number | null>(null)

  const [silenceAlerts, setSilenceAlerts] = useState<EnrichedAlert[] | null>(null)
  const { data: clusters = [] } = useQuery({ queryKey: ['clusters'], queryFn: fetchClusters })
  const clusterNames = clusters.map((c) => c.name)

  function persistCollapsed(next: Set<string>) {
    setCollapsedSections(next)
    try {
      window.localStorage.setItem(collapsedStorageKey, JSON.stringify(Array.from(next)))
    } catch {
      // ignore write errors
    }
  }

  function persistSectionOrder(next: string[]) {
    setSectionOrder(next)
    try {
      window.localStorage.setItem(orderStorageKey, JSON.stringify(next))
    } catch {
      // ignore write errors
    }
  }

  useEffect(() => {
    setCollapsedSections(new Set(loadStoredArray(collapsedStorageKey)))
    try {
      const raw = window.localStorage.getItem(orderStorageKey)
      if (!raw) {
        setSectionOrder([])
        return
      }
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        setSectionOrder(parsed.filter((item) => typeof item === 'string'))
        return
      }
    } catch {
      // ignore malformed local storage value
    }
    setSectionOrder([])
  }, [collapsedStorageKey, orderStorageKey])

  useEffect(() => () => {
    if (dragGhostRef.current) {
      document.body.removeChild(dragGhostRef.current)
      dragGhostRef.current = null
    }
  }, [])

  const silenceSheet = (
    <Sheet
      open={silenceAlerts !== null}
      onClose={() => setSilenceAlerts(null)}
      className="sm:max-w-2xl lg:max-w-3xl"
    >
      {silenceAlerts && (
        <div className="p-5 pt-10">
          <h2 className="mb-4 text-base font-semibold">Create silence</h2>
          <SilenceForm
            availableClusters={
              clusterNames.length > 0
                ? clusterNames
                : [...new Set(silenceAlerts.map((a) => a.clusterName))]
            }
            prefillAlerts={silenceAlerts}
            onSuccess={() => setSilenceAlerts(null)}
            onCancel={() => setSilenceAlerts(null)}
          />
        </div>
      )}
    </Sheet>
  )

  // Resolved mode: flat grid sorted by endsAt desc, each alert is its own card
  if (resolvedMode) {
    const sorted = [...alerts].sort(
      (a, b) => new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime(),
    )
    if (sorted.length === 0) {
      return <EmptyState />
    }
    const cols: EnrichedAlert[][] = Array.from({ length: numCols }, () => [])
    sorted.forEach((alert, i) => cols[i % numCols].push(alert))
    return (
      <>
        <div className="flex gap-3">
          {cols.map((colAlerts, colIdx) => (
            <div key={colIdx} className="flex min-w-0 flex-1 flex-col gap-3">
              {colAlerts.map((alert) => (
                <AlertCard
                  key={alert.fingerprint}
                  alerts={[alert]}
                  silences={silences}
                  onClick={onSelectAlert}
                  selectedFingerprint={selectedFingerprint}
                  onCreateSilence={setSilenceAlerts}
                  showSeverityBadge={groupByLabel !== 'severity'}
                />
              ))}
            </div>
          ))}
        </div>
        {silenceSheet}
      </>
    )
  }

  // Group by configured label + alertname
  const groupMap = new Map<string, CardGroup>()
  for (const alert of alerts) {
    const labels = getFilterableLabels(alert)
    const alertname = alert.labels['alertname'] ?? 'unknown'
    const groupValue = labels[groupByLabel] ?? 'none'
    const key = `${groupValue}:${alertname}`
    const existing = groupMap.get(key)
    if (existing) {
      existing.alerts.push(alert)
    } else {
      groupMap.set(key, { alertname, groupValue, alerts: [alert] })
    }
  }

  // Sort groups by configured label, then alertname
  const groups = Array.from(groupMap.values()).sort((a, b) => {
    if (groupByLabel === 'severity') {
      const severityDiff = severityOrder(a.groupValue) - severityOrder(b.groupValue)
      if (severityDiff !== 0) return severityDiff
    } else {
      const labelDiff = a.groupValue.localeCompare(b.groupValue)
      if (labelDiff !== 0) return labelDiff
    }
    return a.alertname.localeCompare(b.alertname)
  })

  // Group by configured label for section headers
  const byGroupValue = new Map<string, CardGroup[]>()
  for (const g of groups) {
    const existing = byGroupValue.get(g.groupValue) ?? []
    existing.push(g)
    byGroupValue.set(g.groupValue, existing)
  }

  const groupValues = Array.from(byGroupValue.keys()).sort((a, b) =>
    groupByLabel === 'severity' ? severityOrder(a) - severityOrder(b) : a.localeCompare(b),
  )
  const orderedGroupValues = [
    ...sectionOrder.filter((v) => groupValues.includes(v)),
    ...groupValues.filter((v) => !sectionOrder.includes(v)),
  ]

  function toggleSection(section: string) {
    const next = new Set(collapsedSections)
    if (next.has(section)) next.delete(section)
    else next.add(section)
    persistCollapsed(next)
  }

  function moveSectionToIndex(sourceSection: string, targetIndex: number) {
    const idx = orderedGroupValues.indexOf(sourceSection)
    if (idx === -1) return
    let insertAt = targetIndex
    if (idx < insertAt) insertAt -= 1
    if (idx === insertAt) return
    const next = [...orderedGroupValues]
    next.splice(idx, 1)
    next.splice(insertAt, 0, sourceSection)
    persistSectionOrder(next)
  }

  function startSectionDrag(e: ReactMouseEvent<HTMLButtonElement>, section: string) {
    e.preventDefault()
    e.stopPropagation()
    setDraggedSection(section)
    const sectionEl = sectionRefs.current[section]
    if (!sectionEl) return

    const rect = sectionEl.getBoundingClientRect()
    const offsetX = e.clientX - rect.left
    const offsetY = e.clientY - rect.top

    const ghost = sectionEl.cloneNode(true) as HTMLElement
    ghost.style.position = 'fixed'
    ghost.style.top = `${rect.top}px`
    ghost.style.left = `${rect.left}px`
    ghost.style.width = `${rect.width}px`
    ghost.style.pointerEvents = 'none'
    ghost.style.opacity = '0.88'
    ghost.style.transform = 'scale(0.98)'
    ghost.style.zIndex = '9999'
    document.body.appendChild(ghost)
    dragGhostRef.current = ghost

    const startIdx = orderedGroupValues.indexOf(section)
    setDragOverIndex(startIdx)
    dragOverIndexRef.current = startIdx

    const onMouseMove = (ev: MouseEvent) => {
      if (dragGhostRef.current) {
        dragGhostRef.current.style.left = `${ev.clientX - offsetX}px`
        dragGhostRef.current.style.top = `${ev.clientY - offsetY}px`
      }
      let nextIdx = orderedGroupValues.length
      for (let i = 0; i < orderedGroupValues.length; i++) {
        const key = orderedGroupValues[i]
        const el = sectionRefs.current[key]
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (ev.clientY < r.top + r.height / 2) {
          nextIdx = i
          break
        }
      }
      setDragOverIndex(nextIdx)
      dragOverIndexRef.current = nextIdx
    }

    const onMouseUp = () => {
      const dropIdx = dragOverIndexRef.current
      if (dropIdx !== null) moveSectionToIndex(section, dropIdx)
      setDraggedSection(null)
      setDragOverIndex(null)
      dragOverIndexRef.current = null
      if (dragGhostRef.current) {
        document.body.removeChild(dragGhostRef.current)
        dragGhostRef.current = null
      }
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  if (groups.length === 0) {
    return (
      <>
        <EmptyState />
        {silenceSheet}
      </>
    )
  }

  return (
    <>
    <div className="space-y-4">
      {draggedSection && (
        <div className="text-[10px] text-muted-foreground">
          Drop on a dashed line to reposition the group
        </div>
      )}
      {orderedGroupValues.map((groupValue, sectionIdx) => {
        const sectionGroups = byGroupValue.get(groupValue) ?? []
        const distributed = distributeColumns(sectionGroups, silences, numCols)
        const isCollapsed = collapsedSections.has(groupValue)
        const sectionAlertCount = sectionGroups.reduce((sum, g) => sum + g.alerts.length, 0)
        return (
          <div key={groupValue}>
            <div
              className={draggedSection ? 'h-2' : 'h-0'}
            >
              {dragOverIndex === sectionIdx && (
                <div className="h-0 border-t-2 border-dashed border-primary/80" />
              )}
            </div>
            <section
              ref={(el) => {
                sectionRefs.current[groupValue] = el
              }}
              className={draggedSection === groupValue ? 'opacity-50' : undefined}
            >
            <div className="mb-2 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => toggleSection(groupValue)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer"
                aria-expanded={!isCollapsed}
              >
                {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                <span className={`h-2 w-2 rounded-full shrink-0 ${SEVERITY_DOT[groupValue] ?? 'bg-slate-500'}`} />
                {groupByLabel === 'severity'
                  ? (SEVERITY_LABEL[groupValue] ?? groupValue)
                  : `${groupByLabel}: ${groupValue}`}{' '}
                <span className="ml-1 text-muted-foreground">({sectionAlertCount})</span>
              </button>
              {!isFullscreen && (
                <button
                  type="button"
                  onMouseDown={(e) => startSectionDrag(e, groupValue)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground/45 hover:text-muted-foreground hover:bg-accent/30 cursor-grab active:cursor-grabbing"
                  aria-label="Drag section"
                  title="Drag section"
                >
                  <Grip className="h-3 w-3" />
                </button>
              )}
            </div>
            {!isCollapsed && (
              <div className="flex gap-3">
                {distributed.map((colGroups, colIdx) => (
                  <div key={colIdx} className="flex min-w-0 flex-1 flex-col gap-3">
                    {colGroups.map((group) => (
                      <AlertCard
                        key={`${group.groupValue}:${group.alertname}`}
                        alerts={group.alerts}
                        silences={silences}
                        onClick={onSelectAlert}
                        selectedFingerprint={selectedFingerprint}
                        onCreateSilence={setSilenceAlerts}
                        showSeverityBadge={groupByLabel !== 'severity'}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
            </section>
          </div>
        )
      })}
      <div className={draggedSection ? 'h-2' : 'h-0'}>
        {dragOverIndex === orderedGroupValues.length && (
          <div className="h-0 border-t-2 border-dashed border-primary/80" />
        )}
      </div>
    </div>
    {silenceSheet}
    </>
  )
}
