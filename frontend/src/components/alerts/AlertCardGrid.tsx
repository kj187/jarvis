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
  groupingEnabled?: boolean
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

function computeAutoColumns(): number {
  const w = window.innerWidth
  if (w >= 1536) return 4
  if (w >= 1280) return 3
  if (w >= 640) return 2
  return 1
}

// Settings' `cardColumns` overrides the responsive breakpoint on every
// screen size when set to a fixed number; 'auto' (the default) keeps the
// existing 1/2/3/4 behavior.
function useColumns(): number {
  const cardColumns = useSettingsStore((s) => s.cardColumns)
  const [autoCols, setAutoCols] = useState(computeAutoColumns)
  useEffect(() => {
    const update = () => setAutoCols(computeAutoColumns())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return cardColumns === 'auto' ? autoCols : cardColumns
}

// Most recent `startsAt` across a group's alerts — used to sort groups within
// a section by freshness instead of alphabetically (see the group sort below).
function latestStartsAt(group: CardGroup): number {
  return Math.max(...group.alerts.map((a) => new Date(a.startsAt).getTime()))
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
  groupingEnabled = true,
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
      ariaLabel="Create silence"
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

  function renderFlatGrid(flatAlerts: EnrichedAlert[]) {
    if (flatAlerts.length === 0) {
      return <EmptyState />
    }
    // Never more columns than alerts — same reasoning as the grouped view.
    const flatCols = Math.max(1, Math.min(numCols, flatAlerts.length))
    const cols: EnrichedAlert[][] = Array.from({ length: flatCols }, () => [])
    flatAlerts.forEach((alert, i) => cols[i % flatCols].push(alert))
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
                  showSeverityBadge={!groupingEnabled || groupByLabel !== 'severity'}
                />
              ))}
            </div>
          ))}
        </div>
        {silenceSheet}
      </>
    )
  }

  // Flat grid mode (resolved is always flat, active can be toggled to flat)
  if (resolvedMode) {
    const sorted = [...alerts].sort(
      (a, b) => new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime(),
    )
    return renderFlatGrid(sorted)
  }
  if (!groupingEnabled) {
    return renderFlatGrid(alerts)
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

  // Sort groups by configured label, then by freshness (most recently fired
  // group first) — alphabetical order put the oldest and newest problems
  // next to each other for no reason; recency is what actually matters when
  // scanning for what to triage first. Same convention the backend already
  // uses for the flat alert list (AlertStore.Get(), startsAt desc).
  const groups = Array.from(groupMap.values()).sort((a, b) => {
    if (groupByLabel === 'severity') {
      const severityDiff = severityOrder(a.groupValue) - severityOrder(b.groupValue)
      if (severityDiff !== 0) return severityDiff
    } else {
      const labelDiff = a.groupValue.localeCompare(b.groupValue)
      if (labelDiff !== 0) return labelDiff
    }
    const recencyDiff = latestStartsAt(b) - latestStartsAt(a)
    if (recencyDiff !== 0) return recencyDiff
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
        // Never more columns than groups — a lone CRITICAL card shouldn't be
        // squeezed into 1/4 width with 3/4 of the row empty next to it.
        const sectionCols = Math.max(1, Math.min(numCols, sectionGroups.length))
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
              // CSS multi-column instead of hand-rolled bin-packing: the
              // browser balances by real rendered height (collapsed cards,
              // "show more" state, claim notes and all), not a height
              // estimate that has to be kept in sync with every card change.
              <div className="gap-3" style={{ columnCount: sectionCols }}>
                {sectionGroups.map((group) => (
                  <div key={`${group.groupValue}:${group.alertname}`} className="mb-3 break-inside-avoid">
                    <AlertCard
                      alerts={group.alerts}
                      silences={silences}
                      onClick={onSelectAlert}
                      selectedFingerprint={selectedFingerprint}
                      onCreateSilence={setSilenceAlerts}
                      showSeverityBadge={groupByLabel !== 'severity'}
                    />
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
