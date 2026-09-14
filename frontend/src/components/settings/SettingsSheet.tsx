import { useState, useRef, useMemo, useEffect, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { X, RotateCcw, Info, Grip, ArrowUp, Eye, EyeOff, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sheet } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { formatTime, HIDDEN_LABEL_KEYS } from '@/lib/alertUtils'
import {
  useSettingsStore,
  ALLOWED_SILENCE_DURATIONS,
  CARD_COLUMN_OPTIONS,
  DEFAULT_SETTINGS,
} from '@/store/useSettingsStore'
import type { CardColumns } from '@/store/useSettingsStore'
import type { DefaultFilter } from '@/store/useSettingsStore'
import type { LabelMatcherOperator } from '@/types'
import { useAlerts } from '@/hooks/useAlerts'
import { getFilterableLabels } from '@/lib/alertUtils'
import { useAuthStore } from '@/store/authStore'

interface LabelStats {
  count: number
  distinct: number
}

interface SettingsSheetProps {
  open: boolean
  onClose: () => void
}

// ── Segmented control ─────────────────────────────────────────────────────────

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="flex overflow-hidden rounded border border-border text-xs bg-input">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'px-3 py-1.5 transition-colors cursor-pointer',
            value === opt.value
              ? 'bg-accent text-foreground font-medium'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── Default filter autocomplete input ─────────────────────────────────────────

function ComboInput({
  value,
  onChangeValue,
  placeholder,
  options,
  className,
  onKeyDown,
}: {
  value: string
  onChangeValue: (v: string) => void
  placeholder?: string
  options: string[]
  className?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const filtered = options.filter(
    (o) => !value || o.toLowerCase().includes(value.toLowerCase()),
  )

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Input
        value={value}
        onChange={(e) => onChangeValue(e.target.value)}
        placeholder={placeholder}
        className="h-7 text-xs bg-input"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
          onKeyDown?.(e)
        }}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-full max-h-48 overflow-y-auto rounded border border-border shadow-lg combo-dropdown bg-input">
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                onChangeValue(opt)
                setOpen(false)
              }}
              className="w-full px-3 py-1.5 text-left text-xs text-foreground hover:bg-accent/60 cursor-pointer whitespace-nowrap"
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Scrollable list with a visible "more content" fade ─────────────────────────

// A themed `::-webkit-scrollbar` alone isn't a reliable affordance any more:
// several current Chromium builds render an "overlay" scrollbar for
// `overflow-y-auto`/`scroll` that ignores `::-webkit-scrollbar-*` styling
// entirely and only flashes briefly on an active scroll gesture — exactly
// the "you can't tell it's scrollable" problem reported for this panel.
// A CSS-only fade at the clipped edge doesn't depend on the browser's
// scrollbar mode at all, so it's the actual fix; `.themed-scrollbar` (see
// index.css) is kept alongside as a progressive enhancement for browsers
// that do render a classic scrollbar (Firefox always does).
function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [atTop, setAtTop] = useState(true)
  const [atBottom, setAtBottom] = useState(true)

  const check = () => {
    const el = ref.current
    if (!el) return
    setAtTop(el.scrollTop <= 1)
    setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 1)
  }

  // Re-checks on every render (cheap DOM reads) so content changes that
  // don't fire a scroll event — e.g. the "Other labels" search filtering
  // rows in or out — still update the fade.
  useEffect(() => {
    check()
  })

  return { ref, atTop, atBottom, onScroll: check }
}

function ScrollFadeList({
  className,
  testId,
  grow = false,
  minHeightClassName,
  children,
}: {
  className?: string
  testId?: string
  /** Fill the remaining height of a flex-column ancestor instead of a fixed
      max-height — the caller's flex chain (`flex flex-col min-h-0`) must
      reach this component for it to have anything to grow into. */
  grow?: boolean
  /** A min-height floor for `grow` mode, kept on the outer (non-flex-1) wrapper
      rather than mixed into `className` on the flex-1 element itself — two
      `min-h-*` utilities on the same element race on Tailwind's generated
      rule order, not on JSX/className order, so `min-h-0` isn't guaranteed
      to lose to a later `min-h-[8rem]` the way plain CSS cascade intuition
      would suggest. */
  minHeightClassName?: string
  children: React.ReactNode
}) {
  const { ref, atTop, atBottom, onScroll } = useScrollEdges<HTMLDivElement>()
  return (
    <div className={cn('relative', grow && 'flex min-h-0 flex-1 flex-col', minHeightClassName)}>
      <div
        ref={ref}
        onScroll={onScroll}
        data-testid={testId}
        className={cn('themed-scrollbar overflow-y-auto', grow && 'min-h-0 flex-1', className)}
      >
        {children}
      </div>
      {!atTop && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-3 bg-gradient-to-b from-card to-transparent" />
      )}
      {!atBottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t from-card to-transparent" />
      )}
    </div>
  )
}

function LabelStatsHint({ stats }: { stats: LabelStats }) {
  return (
    <span className="shrink-0 text-[10px] text-muted-foreground">
      {stats.count} alerts · {stats.distinct} values
    </span>
  )
}

// Mouse-driven drag reorder — same technique as AlertCardGrid's section drag
// (no dnd-kit dependency): drag the Grip handle, track which row the pointer
// is currently over via each row's own bounding rect, drop to reorder.
function PriorityOrderList({
  order,
  getStats,
  onReorder,
  onRemove,
}: {
  order: string[]
  getStats: (key: string) => LabelStats
  onReorder: (next: string[]) => void
  onRemove: (key: string) => void
}) {
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const dragOverIndexRef = useRef<number | null>(null)

  function startDrag(e: ReactMouseEvent<HTMLButtonElement>, key: string) {
    e.preventDefault()
    setDraggingKey(key)
    const startIdx = order.indexOf(key)
    setDragOverIndex(startIdx)
    dragOverIndexRef.current = startIdx

    const onMouseMove = (ev: MouseEvent) => {
      let nextIdx = order.length
      for (let i = 0; i < order.length; i++) {
        const el = rowRefs.current[order[i]]
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (ev.clientY < rect.top + rect.height / 2) {
          nextIdx = i
          break
        }
      }
      setDragOverIndex(nextIdx)
      dragOverIndexRef.current = nextIdx
    }

    const onMouseUp = () => {
      const dropIdx = dragOverIndexRef.current
      const fromIdx = order.indexOf(key)
      if (dropIdx !== null) {
        let insertAt = dropIdx
        if (fromIdx < insertAt) insertAt -= 1
        if (fromIdx !== insertAt) {
          const next = [...order]
          next.splice(fromIdx, 1)
          next.splice(insertAt, 0, key)
          onReorder(next)
        }
      }
      setDraggingKey(null)
      setDragOverIndex(null)
      dragOverIndexRef.current = null
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  return (
    <ScrollFadeList className="max-h-96 space-y-1 pr-1">
      {order.map((key, i) => (
        <div key={key}>
          <div className={draggingKey ? 'h-1.5' : 'h-0'}>
            {dragOverIndex === i && <div className="h-0 border-t-2 border-dashed border-primary/80" />}
          </div>
          <div
            ref={(el) => { rowRefs.current[key] = el }}
            className={cn(
              'flex items-center gap-1.5 rounded border border-border bg-input px-2 py-1',
              draggingKey === key && 'opacity-50',
            )}
          >
            <button
              type="button"
              onMouseDown={(e) => startDrag(e, key)}
              aria-label={`Drag ${key} to reorder`}
              title="Drag to reorder"
              className="shrink-0 cursor-grab text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
            >
              <Grip className="h-3.5 w-3.5" />
            </button>
            <span className="flex-1 truncate text-xs font-medium">{key}</span>
            <LabelStatsHint stats={getStats(key)} />
            <button
              type="button"
              onClick={() => onRemove(key)}
              aria-label={`Remove ${key} from priority order`}
              title="Remove from priority order"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      ))}
      <div className={draggingKey ? 'h-1.5' : 'h-0'}>
        {dragOverIndex === order.length && <div className="h-0 border-t-2 border-dashed border-primary/80" />}
      </div>
    </ScrollFadeList>
  )
}

function OtherLabelRow({
  labelKey,
  stats,
  hidden,
  onToggleHidden,
  onAddToPriority,
}: {
  labelKey: string
  stats: LabelStats
  hidden: boolean
  onToggleHidden: () => void
  onAddToPriority: () => void
}) {
  return (
    <div className={cn('flex items-center gap-1.5 rounded border border-border bg-input px-2 py-1', hidden && 'opacity-50')}>
      <span className="flex-1 truncate text-xs">{labelKey}</span>
      <LabelStatsHint stats={stats} />
      <button
        type="button"
        onClick={onToggleHidden}
        aria-label={hidden ? `Show ${labelKey}` : `Hide ${labelKey}`}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={onAddToPriority}
        aria-label={`Add ${labelKey} to priority order`}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  title,
  className,
  children,
}: {
  title: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('space-y-3', className)}>
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  )
}

function InfoTooltip({ text }: { text: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const ref = useRef<HTMLSpanElement>(null)

  return (
    <span
      ref={ref}
      className="inline-flex cursor-help"
      onMouseEnter={() => setRect(ref.current?.getBoundingClientRect() ?? null)}
      onMouseLeave={() => setRect(null)}
    >
      <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 hover:text-muted-foreground transition-colors" />
      {rect && createPortal(
        <div
          className="fixed z-[9999] max-w-[280px] rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md pointer-events-none"
          style={{
            left: rect.left + rect.width / 2,
            top: rect.bottom + 6,
            transform: 'translateX(-50%)',
          }}
        >
          {text}
        </div>,
        document.body,
      )}
    </span>
  )
}

function SettingRow({
  label,
  info,
  hint,
  children,
}: {
  label: string
  info?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-sm">
          {label}
          {info && <InfoTooltip text={info} />}
        </span>
        {children}
      </div>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

const OPERATORS: LabelMatcherOperator[] = ['=', '!=', '=~', '!~']

const SILENCE_DURATION_LABELS: Record<number, string> = {
  15: '15 min',
  30: '30 min',
  60: '1 hour',
  240: '4 hours',
  480: '8 hours',
  1440: '1 day',
  4320: '3 days',
}

// ── Main SettingsSheet ─────────────────────────────────────────────────────────

export function SettingsSheet({ open, onClose }: SettingsSheetProps) {
  const settings = useSettingsStore()
  const update = useSettingsStore((s) => s.update)
  const reset = useSettingsStore((s) => s.reset)
  const origin = useSettingsStore((s) => s.origin)
  const syncState = useSettingsStore((s) => s.syncState)
  const providerMode = useAuthStore((s) => s.providerInfo?.mode)

  const { data: allAlerts = [] } = useAlerts()
  const labelValueMap = useMemo(() => {
    const map = new Map<string, Set<string>>()
    allAlerts.forEach((a) => {
      Object.entries(getFilterableLabels(a)).forEach(([k, v]) => {
        if (!v) return
        if (!map.has(k)) map.set(k, new Set())
        map.get(k)!.add(v)
      })
    })
    return map
  }, [allAlerts])
  const availableLabelNames = useMemo(() => Array.from(labelValueMap.keys()).sort(), [labelValueMap])

  // ── Label display (Settings → Labels) ──
  const labelDisplay = settings.labelDisplay
  const labelStatsMap = useMemo(() => {
    const map = new Map<string, { count: number; distinct: Set<string> }>()
    allAlerts.forEach((a) => {
      Object.entries(getFilterableLabels(a)).forEach(([k, v]) => {
        if (!v) return
        if (!map.has(k)) map.set(k, { count: 0, distinct: new Set() })
        const entry = map.get(k)!
        entry.count += 1
        entry.distinct.add(v)
      })
    })
    return map
  }, [allAlerts])

  function getLabelStats(key: string): LabelStats {
    const entry = labelStatsMap.get(key)
    return entry ? { count: entry.count, distinct: entry.distinct.size } : { count: 0, distinct: 0 }
  }

  // Every key seen in currently loaded alerts, plus any key already configured
  // via order/hidden — so a configuration doesn't drop out of the UI once its
  // alerts resolve. Keys with their own dedicated UI element are never listed.
  const configurableLabelKeys = useMemo(() => {
    const keys = new Set<string>()
    labelStatsMap.forEach((_v, k) => keys.add(k))
    labelDisplay.order.forEach((k) => keys.add(k))
    labelDisplay.hidden.forEach((k) => keys.add(k))
    return Array.from(keys).filter((k) => !HIDDEN_LABEL_KEYS.has(k) && !k.startsWith('__'))
  }, [labelStatsMap, labelDisplay.order, labelDisplay.hidden])

  // Alphabetical only — a hidden label keeps its alphabetical spot (shown
  // dimmed via `opacity-50` in OtherLabelRow) rather than jumping to the end,
  // so toggling visibility doesn't reshuffle the list out from under you.
  const otherLabelKeys = useMemo(() => {
    const priority = new Set(labelDisplay.order)
    return configurableLabelKeys
      .filter((k) => !priority.has(k))
      .sort((a, b) => a.localeCompare(b))
  }, [configurableLabelKeys, labelDisplay.order])

  const [labelSearch, setLabelSearch] = useState('')
  const filteredOtherLabelKeys = useMemo(() => {
    const q = labelSearch.trim().toLowerCase()
    if (!q) return otherLabelKeys
    return otherLabelKeys.filter((k) => k.toLowerCase().includes(q))
  }, [otherLabelKeys, labelSearch])

  function reorderPriority(next: string[]) {
    update({ labelDisplay: { ...labelDisplay, order: next } })
  }

  function removeLabelFromOrder(key: string) {
    update({ labelDisplay: { ...labelDisplay, order: labelDisplay.order.filter((k) => k !== key) } })
  }

  function toggleLabelHidden(key: string) {
    const isHidden = labelDisplay.hidden.includes(key)
    const next = isHidden
      ? labelDisplay.hidden.filter((k) => k !== key)
      : [...labelDisplay.hidden, key]
    update({ labelDisplay: { ...labelDisplay, hidden: next } })
  }

  // Acts on whatever the "Other labels" search currently shows, not the
  // full list — searching "aws_" then hiding/showing all only touches the
  // AWS-related labels, not everything.
  const allFilteredHidden =
    filteredOtherLabelKeys.length > 0 &&
    filteredOtherLabelKeys.every((k) => labelDisplay.hidden.includes(k))

  function toggleHideAllFiltered() {
    if (filteredOtherLabelKeys.length === 0) return
    const next = allFilteredHidden
      ? labelDisplay.hidden.filter((k) => !filteredOtherLabelKeys.includes(k))
      : Array.from(new Set([...labelDisplay.hidden, ...filteredOtherLabelKeys]))
    update({ labelDisplay: { ...labelDisplay, hidden: next } })
  }

  function addLabelToOrder(key: string) {
    if (labelDisplay.order.includes(key)) return
    update({ labelDisplay: { ...labelDisplay, order: [...labelDisplay.order, key] } })
  }

  // Scoped reset — only labelDisplay, distinct from the global "Reset all
  // settings" button below (user feedback: that one resetting *everything*
  // wasn't obvious, and there was no way to reset just this section).
  function resetLabelDisplay() {
    update({ labelDisplay: DEFAULT_SETTINGS.labelDisplay })
  }

  // Default filter add-row state
  const [newName, setNewName] = useState('')
  const [newOp, setNewOp] = useState<LabelMatcherOperator>('=')
  const [newValue, setNewValue] = useState('')

  const newValueOptions = newName && labelValueMap.has(newName)
    ? Array.from(labelValueMap.get(newName)!).sort()
    : []

  function addDefaultFilter() {
    if (!newName || !newValue) return
    const next: DefaultFilter = { name: newName, operator: newOp, value: newValue }
    const already = settings.defaultFilters.some(
      (f) => f.name === next.name && f.operator === next.operator && f.value === next.value,
    )
    if (!already) update({ defaultFilters: [...settings.defaultFilters, next] })
    setNewName('')
    setNewOp('=')
    setNewValue('')
  }

  function removeDefaultFilter(i: number) {
    update({ defaultFilters: settings.defaultFilters.filter((_, idx) => idx !== i) })
  }

  // Confirm-reset state
  const [confirmReset, setConfirmReset] = useState(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleReset() {
    if (!confirmReset) {
      setConfirmReset(true)
      resetTimerRef.current = setTimeout(() => setConfirmReset(false), 3000)
      return
    }
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    setConfirmReset(false)
    reset()
  }

  return (
    <Sheet open={open} onClose={onClose} className="sm:max-w-3xl lg:max-w-5xl" ariaLabel="Settings">
      {/* `h-full` (a fixed height), not `min-h-full` (only a floor) — a floor
          still lets this box grow with its children, which defeats the whole
          flex-1/min-h-0 chain below: with nothing capping the total, every
          flex item just takes its content size and the *page* ends up
          scrolling instead of just the "Other labels" list. A fixed height
          gives that chain an actual budget to distribute, so the list is
          what shrinks/grows with window height — the sheet's own scroll
          only ever engages as a last resort if content can't fit even at
          the list's `min-h-[8rem]` floor. */}
      <div className="flex h-full flex-col p-5 pt-10 space-y-6">
        <div className="shrink-0 space-y-1.5">
          <h2 className="text-base font-semibold">Settings</h2>
          {origin === 'server' ? (
            <p className={cn('text-[10px]', syncState === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
              {syncState === 'error' ? 'Could not save — changes are local to this browser' : 'Synced to your account'}
            </p>
          ) : providerMode === 'none' || providerMode === undefined ? (
            <p className="text-[10px] text-muted-foreground">Stored in this browser</p>
          ) : (
            <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-500">
              <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
              <span>Stored in this browser — sign in to sync across devices</span>
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-x-10 gap-y-6 lg:flex-row">
        {/* ── Left column: Display, Default Filter, Silences ── */}
        <div className="space-y-6 lg:flex-1 lg:basis-0">

        {/* ── Display ── */}
        <Section title="Display">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-sm">
                Time format
                <InfoTooltip text="Show timestamps as relative ('5 min ago') or absolute (e.g. 'Jun 17, 20:30')" />
              </span>
              <SegmentedControl
                value={settings.timeFormat}
                onChange={(v) => update({ timeFormat: v })}
                options={[
                  { value: 'relative', label: 'Relative' },
                  { value: 'absolute', label: 'Absolute' },
                ]}
              />
            </div>
            {/* Live preview */}
            <p className="text-[11px] text-muted-foreground/60 text-right">
              e.g. {formatTime(new Date(), settings.timeFormat)}
            </p>
          </div>

          <SettingRow
            label="Default view"
            info="Which view to open on load"
          >
            <SegmentedControl
              value={settings.defaultViewMode}
              onChange={(v) => update({ defaultViewMode: v })}
              options={[
                { value: 'card', label: 'Card' },
                { value: 'list', label: 'List' },
              ]}
            />
          </SettingRow>

          <SettingRow
            label="Card columns"
            info="Number of columns in the Card view grid. Auto adapts to your window width (up to 4); a fixed number overrides that on every screen size."
          >
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={CARD_COLUMN_OPTIONS.length}
                step={1}
                value={settings.cardColumns === 'auto' ? 0 : settings.cardColumns}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  update({ cardColumns: (v === 0 ? 'auto' : v) as CardColumns })
                }}
                className="h-1.5 w-28 cursor-pointer accent-primary"
                aria-label="Card columns"
              />
              <span className="w-10 text-right text-xs font-medium tabular-nums">
                {settings.cardColumns === 'auto' ? 'Auto' : settings.cardColumns}
              </span>
            </div>
          </SettingRow>

          <SettingRow
            label="Claim animation"
            info="Animated snake border on the Claim button for unclaimed alerts"
          >
            <button
              type="button"
              role="switch"
              aria-checked={settings.claimAnimationEnabled}
              onClick={() => update({ claimAnimationEnabled: !settings.claimAnimationEnabled })}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                settings.claimAnimationEnabled ? 'bg-primary' : 'bg-input',
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform',
                  settings.claimAnimationEnabled ? 'translate-x-4' : 'translate-x-0',
                )}
              />
            </button>
          </SettingRow>
        </Section>

        <div className="h-px bg-border" />

        {/* ── Default Filter ── */}
        <Section title="Default Filter">
          <p className="text-[10px] text-muted-foreground -mt-1">
            These filters are always active in the header and can only be changed here.
          </p>

          {/* Add row — same layout as header */}
          <div className="flex items-center gap-1">
            <ComboInput
              value={newName}
              onChangeValue={setNewName}
              placeholder="label"
              options={availableLabelNames}
              className="flex-1"
              onKeyDown={(e) => e.key === 'Enter' && addDefaultFilter()}
            />
            <Select
              value={newOp}
              onChange={(e) => setNewOp(e.target.value as LabelMatcherOperator)}
              className="h-7 w-14 shrink-0"
              selectClassName="text-xs font-mono"
            >
              {OPERATORS.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </Select>
            <ComboInput
              value={newValue}
              onChangeValue={setNewValue}
              placeholder="value"
              options={newValueOptions}
              className="flex-1"
              onKeyDown={(e) => e.key === 'Enter' && addDefaultFilter()}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={addDefaultFilter}
              disabled={!newName || !newValue}
              aria-label="Add default filter"
            >
              +
            </Button>
          </div>

          {/* Active default filter chips */}
          {settings.defaultFilters.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {settings.defaultFilters.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center rounded border border-border h-7 bg-input"
                >
                  <span className="px-2 text-xs text-muted-foreground shrink-0">{f.name}</span>
                  <div className="h-3.5 w-px bg-border shrink-0" />
                  <span className="px-1.5 text-xs text-muted-foreground font-mono shrink-0">{f.operator}</span>
                  <div className="h-3.5 w-px bg-border shrink-0" />
                  <span className="px-2 text-xs text-foreground shrink-0">{f.value}</span>
                  <button
                    type="button"
                    onClick={() => removeDefaultFilter(i)}
                    className="mr-1.5 ml-0.5 cursor-pointer text-muted-foreground hover:text-foreground shrink-0"
                    aria-label={`Remove filter ${f.name}${f.operator}${f.value}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        <div className="h-px bg-border" />

        {/* ── Silences ── */}
        <Section title="Silences">
          <SettingRow label="Default duration" info="Pre-selected duration when opening the Create Silence form">
            <Select
              value={String(settings.defaultSilenceDurationMinutes)}
              onChange={(e) =>
                update({ defaultSilenceDurationMinutes: parseInt(e.target.value, 10) })
              }
              className="h-7 w-28"
              selectClassName="text-xs"
            >
              {ALLOWED_SILENCE_DURATIONS.map((mins) => (
                <option key={mins} value={String(mins)}>
                  {SILENCE_DURATION_LABELS[mins]}
                </option>
              ))}
            </Select>
          </SettingRow>
        </Section>

        </div>

        {/* ── Right column: Labels ── */}
        <div className="flex min-h-0 flex-col lg:flex-1 lg:basis-0">

        {/* ── Labels ── */}
        <Section title="Labels" className="flex min-h-0 flex-1 flex-col">
          <div className="-mt-1 flex shrink-0 items-start justify-between gap-3">
            <p className="text-[10px] text-muted-foreground">
              Choose which label chips show on the card and list views, and in
              what order. The alert detail panel always shows every label,
              regardless of what's configured here.
            </p>
            <button
              type="button"
              onClick={resetLabelDisplay}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap text-[10px] text-muted-foreground hover:text-foreground"
              title="Reset only this Labels section (priority order and hidden labels) back to its default — other settings are untouched"
            >
              <RotateCcw className="h-3 w-3" />
              Reset labels
            </button>
          </div>

          {allAlerts.length === 0 ? (
            <p className="shrink-0 text-xs text-muted-foreground">No labels seen yet.</p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              {labelDisplay.order.length > 0 && (
                <div className="shrink-0 space-y-1">
                  <span className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                    Priority order
                    <InfoTooltip text="These labels always show first, in this order. Drag the grip handle to reorder; click × to send one back to Other labels." />
                  </span>
                  <PriorityOrderList
                    order={labelDisplay.order}
                    getStats={getLabelStats}
                    onReorder={reorderPriority}
                    onRemove={removeLabelFromOrder}
                  />
                </div>
              )}

              {/* Grows to fill whatever vertical space is left in the sheet
                  so "Reset all settings" sits at the bottom of the viewport
                  instead of floating above empty space — and shrinks back
                  down (to `min-h-[8rem]` on the list itself) as the window
                  gets shorter, as long as there are enough labels to need it. */}
              <div className="flex min-h-0 flex-1 flex-col gap-1">
                <div className="flex shrink-0 items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                    Other labels
                    <InfoTooltip text="Every other label found on your alerts, alphabetically. Click the eye to show or hide it as a chip; click ↑ to add it to the priority order above." />
                  </span>
                  <button
                    type="button"
                    onClick={toggleHideAllFiltered}
                    disabled={filteredOtherLabelKeys.length === 0}
                    className="shrink-0 cursor-pointer text-[10px] text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:text-muted-foreground"
                    title={labelSearch ? 'Applies to the labels matching your filter' : 'Applies to every label in this list'}
                  >
                    {allFilteredHidden ? 'Show all' : 'Hide all'}
                  </button>
                </div>
                <div className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-input px-1.5">
                  <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <input
                    value={labelSearch}
                    onChange={(e) => setLabelSearch(e.target.value)}
                    placeholder="Filter labels…"
                    className="h-full min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
                  />
                  {labelSearch && (
                    <button
                      type="button"
                      onClick={() => setLabelSearch('')}
                      className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                      aria-label="Clear filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <ScrollFadeList testId="other-labels-list" grow minHeightClassName="min-h-[8rem]" className="space-y-1 pr-1">
                  {filteredOtherLabelKeys.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-muted-foreground">
                      {labelSearch ? `No labels match "${labelSearch}".` : 'No other labels.'}
                    </p>
                  ) : (
                    filteredOtherLabelKeys.map((key) => (
                      <OtherLabelRow
                        key={key}
                        labelKey={key}
                        stats={getLabelStats(key)}
                        hidden={labelDisplay.hidden.includes(key)}
                        onToggleHidden={() => toggleLabelHidden(key)}
                        onAddToPriority={() => addLabelToOrder(key)}
                      />
                    ))
                  )}
                </ScrollFadeList>
              </div>
            </div>
          )}
        </Section>

        </div>
        </div>

        <div className="h-px shrink-0 bg-border" />

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleReset}
          className={cn(
            'w-full shrink-0 text-xs gap-1.5',
            confirmReset && 'border-destructive text-destructive hover:bg-destructive/10',
          )}
        >
          <RotateCcw className="h-3 w-3" />
          {confirmReset ? 'Click again to confirm — resets everything' : 'Reset all settings'}
        </Button>
      </div>
    </Sheet>
  )
}
