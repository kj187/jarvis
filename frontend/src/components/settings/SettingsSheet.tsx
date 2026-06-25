import { useState, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, RotateCcw, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sheet } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { formatTime } from '@/lib/alertUtils'
import {
  useSettingsStore,
  ALLOWED_SILENCE_DURATIONS,
  POLL_OPTIONS,
} from '@/store/useSettingsStore'
import type { DefaultFilter } from '@/store/useSettingsStore'
import type { LabelMatcherOperator } from '@/types'
import { useVersion } from '@/hooks/useVersion'
import { useAlerts } from '@/hooks/useAlerts'
import { getFilterableLabels } from '@/lib/alertUtils'

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

// ── Poll interval slider ───────────────────────────────────────────────────────

function PollSlider({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  const idx = POLL_OPTIONS.indexOf(value as (typeof POLL_OPTIONS)[number])
  const safeIdx = idx === -1 ? POLL_OPTIONS.indexOf(15) : idx

  return (
    <div className="space-y-2">
      <input
        type="range"
        min={0}
        max={POLL_OPTIONS.length - 1}
        step={1}
        value={safeIdx}
        onChange={(e) => onChange(POLL_OPTIONS[parseInt(e.target.value, 10)])}
        className="w-full cursor-pointer accent-primary"
        aria-label="Poll interval"
      />
      <div className="flex justify-between">
        {POLL_OPTIONS.map((opt, i) => (
          <span
            key={opt}
            onClick={() => onChange(opt)}
            className={cn(
              'cursor-pointer text-[10px] transition-colors',
              i === safeIdx
                ? 'text-foreground font-semibold'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt}s
          </span>
        ))}
      </div>
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

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
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
  const version = useVersion()

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
  const groupByLabelOptions = useMemo(() => {
    const unique = new Set(['severity', ...availableLabelNames, settings.groupByLabel])
    return Array.from(unique).sort((a, b) => {
      if (a === 'severity') return -1
      if (b === 'severity') return 1
      return a.localeCompare(b)
    })
  }, [availableLabelNames, settings.groupByLabel])

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
    <Sheet open={open} onClose={onClose} className="sm:max-w-sm">
      <div className="p-5 pt-10 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Settings</h2>
          {version && (
            <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {version}
            </span>
          )}
        </div>

        <>

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
            label="Group alerts by label"
            info="Used for section grouping in Card and List views. Defaults to severity."
          >
            <Select
              value={settings.groupByLabel}
              onChange={(e) => update({ groupByLabel: e.target.value })}
              className="h-7 w-40"
              selectClassName="text-xs"
            >
              {groupByLabelOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
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

        <div className="h-px bg-border" />

        {/* ── Polling ── */}
        <Section title="Polling">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm">
                Poll interval
                <InfoTooltip text="How often Jarvis fetches fresh data from Alertmanager (WebSocket delivers real-time updates between polls)" />
              </span>
              <span className="text-sm font-medium tabular-nums">{settings.pollIntervalSeconds}s</span>
            </div>
            <PollSlider
              value={settings.pollIntervalSeconds}
              onChange={(v) => update({ pollIntervalSeconds: v })}
            />
          </div>
        </Section>

        <div className="h-px bg-border" />

        {/* ── Footer ── */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleReset}
            className={cn(
              'w-full text-xs gap-1.5',
              confirmReset && 'border-destructive text-destructive hover:bg-destructive/10',
            )}
          >
            <RotateCcw className="h-3 w-3" />
            {confirmReset ? 'Click again to confirm reset' : 'Reset to defaults'}
          </Button>
        </>
      </div>
    </Sheet>
  )
}
