import { useState, useRef, useMemo, useEffect, useLayoutEffect, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { X, RotateCcw, Info, Grip, Pin, Eye, EyeOff, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sheet } from '@/components/ui/sheet'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { formatTime, HIDDEN_LABEL_KEYS, labelColorStyle } from '@/lib/alertUtils'
import {
  useSettingsStore,
  ALLOWED_SILENCE_DURATIONS,
  CARD_COLUMN_OPTIONS,
  DEFAULT_SETTINGS,
} from '@/store/useSettingsStore'
import type { CardColumns } from '@/store/useSettingsStore'
import { LABEL_COLORS, type LabelColor } from '@/lib/settingsUtils'
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
  // don't fire a scroll event — e.g. the Labels search filtering
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

/**
 * Round color swatch — hollow when the label has no color, filled with its
 * palette color otherwise. Click opens a small palette popover: a fixed-
 * position portal positioned from the trigger's own bounding rect (same
 * technique as LabelChip's operator popover) so it isn't clipped by the
 * scrollable label list it lives inside.
 */
function LabelColorSwatch({
  labelKey,
  color,
  onChange,
}: {
  labelKey: string
  color: LabelColor | undefined
  onChange: (color: LabelColor | null) => void
}) {
  const theme = useSettingsStore((s) => s.theme)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // The popover's size isn't known until it's rendered — nudge it back onto
  // the viewport right after paint (rows can sit hard against the sheet's
  // right/bottom edge).
  useLayoutEffect(() => {
    if (!open) return
    const el = popoverRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const overflowRight = rect.right - (window.innerWidth - 8)
    const overflowBottom = rect.bottom - (window.innerHeight - 8)
    if (overflowRight > 0 || overflowBottom > 0) {
      setPos((p) => (p ? {
        top: overflowBottom > 0 ? Math.max(8, p.top - overflowBottom) : p.top,
        left: overflowRight > 0 ? Math.max(8, p.left - overflowRight) : p.left,
      } : p))
    }
  }, [open])

  function togglePopover() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.left })
    }
    setOpen(!open)
  }

  function choose(next: LabelColor | null) {
    onChange(next)
    setOpen(false)
  }

  // The chip's text color is the saturated variant of a palette entry in
  // both themes — the chip background is too close to the sheet ground to
  // read as a 16px dot.
  const dotColor = (name: LabelColor) => labelColorStyle('k', { k: name }, theme)?.color

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={togglePopover}
        aria-label={`Choose a chip color for ${labelKey}`}
        aria-expanded={open}
        title={color ? `Chip color: ${color}` : 'No chip color — click to choose one'}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded-full border-2 border-muted-foreground/50"
        style={{ backgroundColor: color ? dotColor(color) : 'transparent' }}
      />
      {open && pos && createPortal(
        <div
          ref={popoverRef}
          data-testid="label-color-picker"
          className="fixed z-50 flex items-center gap-1.5 rounded-lg border border-border bg-popover p-2 shadow-lg"
          style={{ top: pos.top, left: pos.left }}
        >
          {LABEL_COLORS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => choose(name)}
              aria-label={`Color ${labelKey} ${name}`}
              aria-pressed={color === name}
              title={name}
              className={cn(
                'h-5 w-5 cursor-pointer rounded-full ring-offset-2 ring-offset-popover transition-transform hover:scale-110',
                color === name && 'ring-2 ring-foreground',
              )}
              style={{ backgroundColor: dotColor(name) }}
            />
          ))}
          <button
            type="button"
            onClick={() => choose(null)}
            aria-label={`Remove color for ${labelKey}`}
            aria-pressed={!color}
            title="No color"
            className={cn(
              'flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-dashed border-muted-foreground/60 text-muted-foreground ring-offset-2 ring-offset-popover hover:text-foreground',
              !color && 'ring-2 ring-foreground',
            )}
          >
            <X className="h-3 w-3" />
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}

interface LabelRowProps {
  labelKey: string
  stats: LabelStats
  pinned: boolean
  hidden: boolean
  color: LabelColor | undefined
  onTogglePinned: () => void
  onToggleHidden: () => void
  onColorChange: (color: LabelColor | null) => void
}

/**
 * One row of Settings → Labels — identical for pinned and unpinned labels.
 * Pin and hide are mutually exclusive; the caller's toggles enforce that.
 * Pinned rows additionally get a drag grip (see PinnedLabelRows).
 */
function LabelRow({
  labelKey,
  stats,
  pinned,
  hidden,
  color,
  onTogglePinned,
  onToggleHidden,
  onColorChange,
  onGripMouseDown,
  dragging = false,
}: LabelRowProps & {
  onGripMouseDown?: (e: ReactMouseEvent<HTMLButtonElement>) => void
  dragging?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded border border-border bg-input px-2 py-1',
        dragging && 'opacity-50',
      )}
    >
      {onGripMouseDown ? (
        <button
          type="button"
          onMouseDown={onGripMouseDown}
          aria-label={`Drag ${labelKey} to reorder`}
          title="Drag to reorder"
          className="shrink-0 cursor-grab text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
        >
          <Grip className="h-3.5 w-3.5" />
        </button>
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <span className={cn('flex min-w-0 flex-1 items-center gap-2', hidden && 'opacity-50')}>
        <span className={cn('flex-1 truncate text-xs', pinned && 'font-medium')}>{labelKey}</span>
        <LabelStatsHint stats={stats} />
      </span>
      <LabelColorSwatch labelKey={labelKey} color={color} onChange={onColorChange} />
      <button
        type="button"
        onClick={onTogglePinned}
        aria-label={pinned ? `Unpin ${labelKey}` : `Pin ${labelKey}`}
        aria-pressed={pinned}
        title={pinned ? 'Unpin' : 'Pin — show first'}
        className={cn('shrink-0', pinned ? 'text-primary' : 'text-muted-foreground/60 hover:text-foreground')}
      >
        <Pin className={cn('h-3.5 w-3.5', pinned && 'fill-current')} />
      </button>
      <button
        type="button"
        onClick={onToggleHidden}
        aria-label={hidden ? `Show ${labelKey}` : `Hide ${labelKey}`}
        aria-pressed={hidden}
        title={hidden ? 'Show' : 'Hide — collapse into “+N”'}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

// Mouse-driven drag reorder for the pinned rows — same technique as
// AlertCardGrid's section drag: drag the grip, track which row the pointer is
// over via each row's own bounding rect, drop to reorder. Only offered while the list isn't search-filtered, so the rows on
// screen are always the complete `order`.
function PinnedLabelRows({
  keys,
  draggable,
  onReorder,
  rowProps,
}: {
  keys: string[]
  draggable: boolean
  onReorder: (next: string[]) => void
  rowProps: (key: string) => LabelRowProps
}) {
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const dragOverIndexRef = useRef<number | null>(null)

  function startDrag(e: ReactMouseEvent<HTMLButtonElement>, key: string) {
    e.preventDefault()
    setDraggingKey(key)
    const startIdx = keys.indexOf(key)
    setDragOverIndex(startIdx)
    dragOverIndexRef.current = startIdx

    const onMouseMove = (ev: MouseEvent) => {
      let nextIdx = keys.length
      for (let i = 0; i < keys.length; i++) {
        const el = rowRefs.current[keys[i]]
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
      const fromIdx = keys.indexOf(key)
      if (dropIdx !== null) {
        const insertAt = fromIdx < dropIdx ? dropIdx - 1 : dropIdx
        if (fromIdx !== insertAt) {
          const next = [...keys]
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

  const dropLine = (i: number) => (
    <div className={draggingKey ? 'h-1.5' : 'h-0'}>
      {dragOverIndex === i && <div className="h-0 border-t-2 border-dashed border-primary/80" />}
    </div>
  )

  return (
    <div data-testid="pinned-labels">
      {keys.map((key, i) => (
        <div key={key}>
          {dropLine(i)}
          <div ref={(el) => { rowRefs.current[key] = el }} className={draggingKey ? '' : 'mb-1'}>
            <LabelRow
              {...rowProps(key)}
              onGripMouseDown={draggable ? (e) => startDrag(e, key) : undefined}
              dragging={draggingKey === key}
            />
          </div>
        </div>
      ))}
      {dropLine(keys.length)}
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

function InfoTooltip({ text, ariaLabel = 'More information' }: { text: string; ariaLabel?: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const ref = useRef<HTMLSpanElement>(null)

  return (
    <span
      ref={ref}
      aria-label={ariaLabel}
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

function SettingsSwitch({
  checked,
  onToggle,
  ariaLabel,
}: {
  checked: boolean
  onToggle: () => void
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={ariaLabel}
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
        checked ? 'bg-primary' : 'bg-input',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  )
}

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

  // ── Labels (Settings → Labels) ──
  const labelDisplay = settings.labelDisplay
  const labelColors = settings.labelColors
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
  // via order/hidden/labelColors — so a configuration doesn't drop out of the
  // UI once its alerts resolve. Keys with their own dedicated UI element are
  // never listed.
  const configurableLabelKeys = useMemo(() => {
    const keys = new Set<string>()
    labelStatsMap.forEach((_v, k) => keys.add(k))
    labelDisplay.order.forEach((k) => keys.add(k))
    labelDisplay.hidden.forEach((k) => keys.add(k))
    Object.keys(labelColors).forEach((k) => keys.add(k))
    return Array.from(keys).filter((k) => !HIDDEN_LABEL_KEYS.has(k) && !k.startsWith('__'))
  }, [labelStatsMap, labelDisplay.order, labelDisplay.hidden, labelColors])

  const [labelSearch, setLabelSearch] = useState('')
  const labelQuery = labelSearch.trim().toLowerCase()

  const pinnedLabelKeys = useMemo(() => {
    const configurable = new Set(configurableLabelKeys)
    return labelDisplay.order.filter((k) => configurable.has(k) && (!labelQuery || k.toLowerCase().includes(labelQuery)))
  }, [configurableLabelKeys, labelDisplay.order, labelQuery])

  // Alphabetical only — a hidden label keeps its spot (dimmed) rather than
  // jumping to the end, so toggling doesn't reshuffle the list under you.
  const unpinnedLabelKeys = useMemo(() => {
    const pinned = new Set(labelDisplay.order)
    return configurableLabelKeys
      .filter((k) => !pinned.has(k) && (!labelQuery || k.toLowerCase().includes(labelQuery)))
      .sort((a, b) => a.localeCompare(b))
  }, [configurableLabelKeys, labelDisplay.order, labelQuery])

  // Pin and hide are mutually exclusive (normalizeSettings: hidden wins), so
  // each toggle clears the other. Always built as `{ order, hidden }` in this
  // key order — computeNextOverrides compares values via JSON.stringify.
  function setLabelDisplay(order: string[], hidden: string[]) {
    update({ labelDisplay: { order, hidden } })
  }

  function togglePinned(key: string) {
    const { order, hidden } = labelDisplay
    if (order.includes(key)) setLabelDisplay(order.filter((k) => k !== key), hidden)
    else setLabelDisplay([...order, key], hidden.filter((k) => k !== key))
  }

  function toggleHidden(key: string) {
    const { order, hidden } = labelDisplay
    if (hidden.includes(key)) setLabelDisplay(order, hidden.filter((k) => k !== key))
    else setLabelDisplay(order.filter((k) => k !== key), [...hidden, key])
  }

  // Acts on the unpinned labels the search currently shows, not the full
  // list — searching "aws_" then hiding all only touches those labels.
  const allUnpinnedHidden =
    unpinnedLabelKeys.length > 0 && unpinnedLabelKeys.every((k) => labelDisplay.hidden.includes(k))

  function toggleHideAllUnpinned() {
    const { order, hidden } = labelDisplay
    const targets = new Set(unpinnedLabelKeys)
    setLabelDisplay(
      order,
      allUnpinnedHidden
        ? hidden.filter((k) => !targets.has(k))
        : [...hidden, ...unpinnedLabelKeys.filter((k) => !hidden.includes(k))],
    )
  }

  function setLabelColor(key: string, color: LabelColor | null) {
    const next = { ...labelColors }
    if (color) next[key] = color
    else delete next[key]
    update({ labelColors: next })
  }

  function labelRowProps(key: string): LabelRowProps {
    return {
      labelKey: key,
      stats: getLabelStats(key),
      pinned: labelDisplay.order.includes(key),
      hidden: labelDisplay.hidden.includes(key),
      color: labelColors[key],
      onTogglePinned: () => togglePinned(key),
      onToggleHidden: () => toggleHidden(key),
      onColorChange: (color) => setLabelColor(key, color),
    }
  }

  const [confirmLabelReset, setConfirmLabelReset] = useState(false)
  const labelResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Scoped two-click reset — mirrors the global reset guard, but only resets
  // the Labels section.
  function resetLabelDisplay() {
    if (!confirmLabelReset) {
      setConfirmLabelReset(true)
      labelResetTimerRef.current = setTimeout(() => setConfirmLabelReset(false), 3000)
      return
    }
    if (labelResetTimerRef.current) clearTimeout(labelResetTimerRef.current)
    setConfirmLabelReset(false)
    update({
      labelDisplay: DEFAULT_SETTINGS.labelDisplay,
      labelColors: DEFAULT_SETTINGS.labelColors,
    })
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
          scrolling instead of just the Labels list. A fixed height
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
        {/* ── Left column: Display, Silences ── */}
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
            <SettingsSwitch
              checked={settings.claimAnimationEnabled}
              onToggle={() => update({ claimAnimationEnabled: !settings.claimAnimationEnabled })}
              ariaLabel="Claim animation"
            />
          </SettingRow>
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
              Pinned labels show first, in this order. Hidden labels collapse into a “+N” chip on each alert and always stay in the detail panel.
            </p>
            <button
              type="button"
              onClick={resetLabelDisplay}
              className={cn(
                'inline-flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded border border-transparent px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground',
                confirmLabelReset && 'border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive',
              )}
              title="Reset only this Labels section (pinned, hidden and colors) — other settings are untouched"
            >
              <RotateCcw className="h-3 w-3" />
              {confirmLabelReset ? 'Click again to confirm — resets labels' : 'Reset labels'}
            </button>
          </div>

          {configurableLabelKeys.length === 0 ? (
            <p className="shrink-0 text-xs text-muted-foreground">No labels seen yet.</p>
          ) : (
            /* Grows to fill whatever vertical space is left in the sheet so
               "Reset all settings" sits at the bottom of the viewport instead
               of floating above empty space — and shrinks back down (to
               `min-h-[8rem]` on the list itself) as the window gets shorter. */
            <div className="flex min-h-0 flex-1 flex-col gap-1.5">
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
              <ScrollFadeList testId="label-list" grow minHeightClassName="min-h-[8rem]" className="pr-1">
                {pinnedLabelKeys.length > 0 && (
                  <PinnedLabelRows
                    keys={pinnedLabelKeys}
                    draggable={!labelQuery}
                    onReorder={(order) => setLabelDisplay(order, labelDisplay.hidden)}
                    rowProps={labelRowProps}
                  />
                )}
                {pinnedLabelKeys.length > 0 && unpinnedLabelKeys.length > 0 && (
                  <div className="mb-1 mt-1 h-px bg-border" />
                )}
                {unpinnedLabelKeys.length > 0 && (
                  <div className="flex items-center justify-between px-1 pb-1">
                    <span className="text-[10px] text-muted-foreground">
                      {labelQuery ? `${unpinnedLabelKeys.length} matching` : 'Other labels'}
                    </span>
                    <button
                      type="button"
                      onClick={toggleHideAllUnpinned}
                      className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground"
                      title={labelQuery ? 'Applies to the unpinned labels matching your filter' : 'Applies to every unpinned label'}
                    >
                      {allUnpinnedHidden ? 'Show all' : 'Hide all'}
                    </button>
                  </div>
                )}
                <div data-testid="unpinned-labels" className="space-y-1">
                  {unpinnedLabelKeys.map((key) => (
                    <LabelRow key={key} {...labelRowProps(key)} />
                  ))}
                </div>
                {labelQuery && pinnedLabelKeys.length === 0 && unpinnedLabelKeys.length === 0 && (
                  <p className="px-1 py-2 text-xs text-muted-foreground">No labels match “{labelSearch}”.</p>
                )}
              </ScrollFadeList>
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
