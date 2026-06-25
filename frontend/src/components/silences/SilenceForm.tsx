import { useState, useCallback, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format, addSeconds, parse, isValid } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { DayPicker } from 'react-day-picker'
import { Plus, X, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ArrowLeft, Check, Loader2, CircleAlert, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { useAlerts } from '@/hooks/useAlerts'
import { useSilences } from '@/hooks/useSilences'
import { useSilenceTemplates } from '@/hooks/useSilenceTemplates'
import { matchesLabelMatchers, pickIdentifierLabel, tzAbbr } from '@/lib/alertUtils'
import { upsertSilence, triggerPoll } from '@/api/client'
import { useSettingsStore } from '@/store/useSettingsStore'
import { useAuthStore } from '@/store/authStore'
import type { EnrichedAlert, LabelMatcher, LabelMatcherOperator, Silence } from '@/types'

const USERNAME_KEY = 'jarvis-username'
const FMT = "yyyy-MM-dd'T'HH:mm"

const DURATION_PRESETS = [
  { label: '30m', days: 0, hours: 0, minutes: 30 },
  { label: '1h',  days: 0, hours: 1, minutes: 0  },
  { label: '4h',  days: 0, hours: 4, minutes: 0  },
  { label: '1d',  days: 1, hours: 0, minutes: 0  },
  { label: '1w',  days: 7, hours: 0, minutes: 0  },
] as const

type Step = 'form' | 'preview' | 'results'

type ClusterResult =
  | { status: 'loading' }
  | { status: 'success'; id: string }
  | { status: 'error'; message: string }

interface SilenceMatcher {
  id: number
  name: string
  operator: LabelMatcherOperator
  value: string
}

let _id = 1
const nextId = () => _id++

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function unescapeRegex(s: string): string {
  return s.replace(/\\([.*+?^${}()|[\]\\])/g, '$1')
}

// ── TagValueInput ─────────────────────────────────────────────────────────────

interface TagValueInputProps {
  value: string
  onChange: (v: string) => void
  suggestions?: string[]
  placeholder?: string
  className?: string
  maxTags?: number
}

function TagValueInput({ value, onChange, suggestions = [], placeholder, className, maxTags }: TagValueInputProps) {
  const tags = value ? value.split('|').filter(Boolean) : []
  const [inputVal, setInputVal] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function addTag(tag: string) {
    const trimmed = tag.trim()
    if (!trimmed || tags.includes(trimmed)) return
    const next = maxTags === 1 ? [trimmed] : [...tags, trimmed]
    onChange(next.join('|'))
    setInputVal('')
  }

  function removeTag(index: number) {
    onChange(tags.filter((_, i) => i !== index).join('|'))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(inputVal)
    }
    if (e.key === 'Backspace' && !inputVal && tags.length > 0) {
      removeTag(tags.length - 1)
    }
  }

  const filtered = suggestions.filter(
    (s) => !tags.includes(s) && s.toLowerCase().includes(inputVal.toLowerCase()),
  )

  return (
    <div className={cn('relative min-w-0', className)}>
      <div
        className="flex min-h-8 flex-wrap items-center gap-1 overflow-hidden rounded border border-input bg-background px-2 py-1 focus-within:ring-1 focus-within:ring-ring cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag, i) => (
          <span
            key={i}
            className="flex shrink-0 items-center gap-0.5 rounded bg-accent px-1.5 py-0.5 font-mono text-[10px]"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(i) }}
              className="ml-0.5 shrink-0 opacity-60 hover:opacity-100 hover:text-destructive cursor-pointer"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={tags.length === 0 ? placeholder : undefined}
          className="min-w-[40px] flex-1 bg-transparent font-mono text-xs outline-none"
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="combo-dropdown absolute left-0 top-full z-50 mt-0.5 max-h-48 w-full overflow-y-auto rounded border border-border bg-popover shadow-md">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={() => { addTag(s); setOpen(false) }}
              className="w-full px-2 py-1.5 text-left font-mono text-xs hover:bg-accent"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── LabelNameInput ────────────────────────────────────────────────────────────

interface LabelNameInputProps {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
  className?: string
}

function LabelNameInput({ value, onChange, suggestions, className }: LabelNameInputProps) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const filterRef = useRef<HTMLInputElement>(null)

  const filtered = filter
    ? suggestions.filter((s) => s.toLowerCase().includes(filter.toLowerCase()))
    : suggestions

  function select(label: string) {
    onChange(label)
    setOpen(false)
    setFilter('')
  }

  function handleFilterKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered.length === 1) select(filtered[0])
      else if (filter.trim()) select(filter.trim())
    }
    if (e.key === 'Escape') {
      setOpen(false)
      setFilter('')
    }
  }

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setTimeout(() => filterRef.current?.focus(), 10)
        }}
        className="flex h-8 w-full items-center justify-between rounded border border-input bg-background px-2 font-mono text-xs hover:border-ring focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
      >
        <span className={value ? 'text-foreground' : 'text-muted-foreground'}>
          {value || 'label'}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => { setOpen(false); setFilter('') }}
          />
          <div className="absolute left-0 top-full z-50 mt-0.5 w-full rounded border border-border bg-popover shadow-md">
            <div className="border-b border-border px-2 py-1.5">
              <input
                ref={filterRef}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={handleFilterKeyDown}
                placeholder="Search…"
                className="w-full bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="combo-dropdown max-h-52 overflow-y-auto">
              {filtered.map((s) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={() => select(s)}
                  className={cn(
                    'w-full px-2.5 py-1.5 text-left font-mono text-xs hover:bg-accent',
                    s === value && 'font-semibold text-foreground',
                  )}
                >
                  {s}
                </button>
              ))}
              {filtered.length === 0 && filter.trim() && (
                <button
                  type="button"
                  onMouseDown={() => select(filter.trim())}
                  className="w-full px-2.5 py-1.5 text-left font-mono text-xs text-muted-foreground hover:bg-accent"
                >
                  Use "{filter.trim()}"
                </button>
              )}
              {filtered.length === 0 && !filter.trim() && (
                <div className="px-2.5 py-2 text-xs text-muted-foreground">No labels</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function buildPrefillMatchers(alerts: EnrichedAlert[]): SilenceMatcher[] {
  if (alerts.length === 0) return [{ id: nextId(), name: '', operator: '=', value: '' }]

  const SKIP = new Set(['receiver', '@receiver', '@cluster'])
  const allKeys = new Set<string>()
  for (const a of alerts) {
    for (const k of Object.keys(a.labels)) {
      if (!SKIP.has(k)) allKeys.add(k)
    }
  }

  const matchers: SilenceMatcher[] = []
  for (const key of allKeys) {
    const values = [...new Set(alerts.map((a) => a.labels[key]).filter(Boolean))]
    if (values.length === 0) continue
    if (values.length === 1) {
      matchers.push({ id: nextId(), name: key, operator: '=', value: values[0] })
    } else {
      matchers.push({
        id: nextId(),
        name: key,
        operator: '=~',
        value: values.join('|'),
      })
    }
  }

  return matchers.length > 0
    ? matchers
    : [{ id: nextId(), name: '', operator: '=', value: '' }]
}

function totalSeconds(days: number, hours: number, minutes: number): number {
  return days * 86400 + hours * 3600 + minutes * 60
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

function normalizeDuration(d: number, h: number, m: number): { days: number; hours: number; minutes: number } {
  if (m >= 60) { h += Math.floor(m / 60); m = m % 60 }
  if (m < 0) { const b = Math.ceil(-m / 60); h -= b; m += b * 60 }
  if (h >= 24) { d += Math.floor(h / 24); h = h % 24 }
  if (h < 0) { const b = Math.ceil(-h / 24); d -= b; h += b * 24 }
  return { days: clamp(d, 0, 365), hours: h, minutes: m }
}

// ── InlineDateTimePicker ─────────────────────────────────────────────────────

interface InlineDateTimePickerProps {
  value: string // "yyyy-MM-dd'T'HH:mm"
  onChange: (v: string) => void
}

function InlineDateTimePicker({ value, onChange }: InlineDateTimePickerProps) {
  const parsed = value ? parse(value, FMT, new Date()) : undefined
  const selected = parsed && isValid(parsed) ? parsed : undefined

  const hour = selected?.getHours() ?? 0
  const minute = selected?.getMinutes() ?? 0

  function handleDaySelect(day: Date | undefined) {
    if (!day) return
    day.setHours(hour, minute, 0, 0)
    onChange(format(day, FMT))
  }

  function adjustHour(delta: number) {
    const base = selected ?? new Date()
    const updated = new Date(base)
    updated.setHours(clamp(hour + delta, 0, 23), minute, 0, 0)
    onChange(format(updated, FMT))
  }

  function adjustMinute(delta: number) {
    const base = selected ?? new Date()
    const updated = new Date(base)
    updated.setHours(hour, clamp(minute + delta, 0, 59), 0, 0)
    onChange(format(updated, FMT))
  }

  const timeSpinners = [
    {
      label: 'h',
      val: hour,
      max: 23,
      inc: () => adjustHour(1),
      dec: () => adjustHour(-1),
      set: (n: number) => {
        const base = selected ?? new Date()
        const updated = new Date(base)
        updated.setHours(clamp(n, 0, 23), minute, 0, 0)
        onChange(format(updated, FMT))
      },
    },
    {
      label: 'm',
      val: minute,
      max: 59,
      inc: () => adjustMinute(1),
      dec: () => adjustMinute(-1),
      set: (n: number) => {
        const base = selected ?? new Date()
        const updated = new Date(base)
        updated.setHours(hour, clamp(n, 0, 59), 0, 0)
        onChange(format(updated, FMT))
      },
    },
  ]

  return (
    <div className="space-y-1.5">
      <div className="flex rounded border border-border bg-background">
        <DayPicker
          mode="single"
          selected={selected}
          defaultMonth={selected ?? new Date()}
          onSelect={handleDaySelect}
          locale={enUS}
          components={{
            Chevron: ({ orientation }) =>
              orientation === 'left'
                ? <ChevronLeft className="h-4 w-4" />
                : <ChevronRight className="h-4 w-4" />,
          }}
          classNames={{
            root: 'p-3',
            months: 'flex flex-col relative',
            month: 'space-y-3',
            month_caption: 'flex items-center justify-center relative h-7',
            caption_label: 'text-sm font-medium text-foreground pointer-events-none select-none',
            nav: 'flex items-center justify-between absolute inset-x-0 top-0 z-10 pointer-events-none',
            button_previous:
              'inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground/80 hover:bg-accent hover:text-foreground cursor-pointer transition-colors pointer-events-auto',
            button_next:
              'inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground/80 hover:bg-accent hover:text-foreground cursor-pointer transition-colors pointer-events-auto',
            month_grid: 'w-full border-collapse',
            weekdays: 'flex',
            weekday: 'w-8 text-center text-[10px] font-medium text-muted-foreground',
            week: 'flex mt-1',
            day: 'relative flex h-8 w-8 items-center justify-center',
            day_button:
              'h-8 w-8 rounded text-sm hover:bg-accent hover:text-foreground focus:outline-none cursor-pointer transition-colors',
            today: '[&>button]:bg-accent [&>button]:text-foreground [&>button]:font-semibold',
            selected:
              '[&>button]:!bg-primary [&>button]:!text-primary-foreground [&>button]:hover:!bg-primary',
            outside: '[&>button]:text-muted-foreground/40',
            disabled: '[&>button]:opacity-30 [&>button]:cursor-not-allowed',
          }}
        />

        {/* Time spinners — right of calendar */}
        <div className="flex items-center gap-4 border-l border-border px-4">
          {timeSpinners.map(({ label, val, max, inc, dec, set }) => (
            <div key={label} className="flex flex-col items-center gap-0.5">
              <button
                type="button"
                onClick={inc}
                className="cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <input
                type="number"
                min={0}
                max={max}
                value={val}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  if (!isNaN(n)) set(n)
                }}
                className="w-10 rounded border border-input bg-background text-center text-2xl font-light tabular-nums focus:outline-none focus:ring-1 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <button
                type="button"
                onClick={dec}
                className="cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <span className="mt-0.5 text-[10px] text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="text-center text-[10px] text-muted-foreground font-mono">
        Local timezone: {tzAbbr}
      </div>
    </div>
  )
}

function diffToSpinners(start: string, end: string): { days: number; hours: number; minutes: number } {
  const diffSecs = Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000))
  return {
    days: Math.floor(diffSecs / 86400),
    hours: Math.floor((diffSecs % 86400) / 3600),
    minutes: Math.floor((diffSecs % 3600) / 60),
  }
}

export interface SilenceFormProps {
  availableClusters: string[]
  prefillAlerts?: EnrichedAlert[]
  prefillSilence?: Silence
  prefillGroup?: Silence[]
  isRecreate?: boolean
  fingerprint?: string
  onSuccess: () => void
  onCancel: () => void
  onSelectAlert?: (fingerprint: string) => void
}

export function SilenceForm({
  availableClusters,
  prefillAlerts,
  prefillSilence,
  prefillGroup,
  isRecreate = false,
  fingerprint,
  onSuccess,
  onCancel,
  onSelectAlert,
}: SilenceFormProps) {
  const { data: allAlerts = [] } = useAlerts()
  const { data: allSilences = [] } = useSilences()
  const qc = useQueryClient()
  const { user, providerInfo } = useAuthStore()
  const authMode = providerInfo?.mode ?? 'none'
  const isEdit = (Boolean(prefillSilence) || Boolean(prefillGroup?.length)) && !isRecreate
  const prefillSource = prefillGroup?.[0] ?? prefillSilence

  const clusterUrlMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of allAlerts) {
      if (a.alertmanagerUrl && !m.has(a.clusterName)) m.set(a.clusterName, a.alertmanagerUrl)
    }
    for (const s of allSilences) {
      if (s.alertmanagerUrl && !m.has(s.clusterName)) m.set(s.clusterName, s.alertmanagerUrl)
    }
    return m
  }, [allAlerts, allSilences])

  const LABEL_SKIP = new Set(['receiver', '@receiver', '@cluster'])

  const labelSuggestions = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const alert of prefillAlerts ?? allAlerts) {
      for (const [k, v] of Object.entries(alert.labels)) {
        if (LABEL_SKIP.has(k)) continue
        const existing = map.get(k) ?? []
        if (!existing.includes(v)) existing.push(v)
        map.set(k, existing)
      }
    }
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillAlerts, allAlerts])

  const labelKeys = useMemo(
    () => [...labelSuggestions.keys()].sort(),
    [labelSuggestions],
  )

  const [step, setStep] = useState<Step>('form')

  const rebuildFromAlerts = isRecreate && prefillSilence?.status.state === 'expired' && (prefillAlerts?.length ?? 0) > 0

  const [selectedClusters, setSelectedClusters] = useState<string[]>(() => {
    if (prefillGroup?.length && !rebuildFromAlerts) return prefillGroup.map((s) => s.clusterName)
    if (prefillSilence && !rebuildFromAlerts) return [prefillSilence.clusterName]
    if (prefillAlerts?.length) return [...new Set(prefillAlerts.map((a) => a.clusterName))]
    return [...availableClusters]
  })

  const [matchers, setMatchers] = useState<SilenceMatcher[]>(() => {
    if (prefillSource?.matchers && !rebuildFromAlerts) {
      return prefillSource.matchers.map((m) => ({
        id: nextId(),
        name: m.name,
        operator: (
          m.isRegex ? (m.isEqual ? '=~' : '!~') : m.isEqual ? '=' : '!='
        ) as LabelMatcherOperator,
        value: m.isRegex ? m.value.split('|').map(unescapeRegex).join('|') : m.value,
      }))
    }
    if (prefillAlerts?.length) return buildPrefillMatchers(prefillAlerts)
    return [{ id: nextId(), name: '', operator: '=', value: '' }]
  })

  // Duration spinners
  const [dDays, setDDays] = useState(() => {
    if (prefillSource && !isRecreate) {
      const { days } = diffToSpinners(prefillSource.startsAt, prefillSource.endsAt)
      return days
    }
    const mins = useSettingsStore.getState().defaultSilenceDurationMinutes
    return Math.floor(mins / (24 * 60))
  })
  const [dHours, setDHours] = useState(() => {
    if (prefillSource && !isRecreate) {
      const { hours } = diffToSpinners(prefillSource.startsAt, prefillSource.endsAt)
      return hours
    }
    const mins = useSettingsStore.getState().defaultSilenceDurationMinutes
    return Math.floor((mins % (24 * 60)) / 60)
  })
  const [dMinutes, setDMinutes] = useState(() => {
    if (prefillSource && !isRecreate) {
      const { minutes } = diffToSpinners(prefillSource.startsAt, prefillSource.endsAt)
      return minutes
    }
    const mins = useSettingsStore.getState().defaultSilenceDurationMinutes
    return mins % 60
  })

  // Start/End datetime — endsAt always initialized (never empty)
  const [startsAt, setStartsAt] = useState(() =>
    prefillSource && !isRecreate
      ? format(new Date(prefillSource.startsAt), FMT)
      : format(new Date(), FMT),
  )
  const [endsAt, setEndsAt] = useState(() => {
    if (prefillSource && !isRecreate) {
      return format(new Date(prefillSource.endsAt), FMT)
    }
    const mins = useSettingsStore.getState().defaultSilenceDurationMinutes
    const d = Math.floor(mins / (24 * 60))
    const h = Math.floor((mins % (24 * 60)) / 60)
    const m = mins % 60
    return format(addSeconds(new Date(), totalSeconds(d, h, m)), FMT)
  })

  const [createdBy, setCreatedBy] = useState(
    () => localStorage.getItem(USERNAME_KEY) ?? useSettingsStore.getState().defaultCreatorName,
  )
  const effectiveCreatedBy = user?.username ?? createdBy
  const [comment, setComment] = useState(prefillSource?.comment ?? '')

  // Template support
  const { data: templates = [] } = useSilenceTemplates()
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')

  const [results, setResults] = useState<Map<string, ClusterResult>>(new Map())
  const [affectedOpen, setAffectedOpen] = useState(false)

  const formLabelMatchers = useMemo<LabelMatcher[]>(
    () => matchers.filter((m) => m.name).map((m) => ({ id: String(m.id), name: m.name, operator: m.operator, value: m.value })),
    [matchers],
  )

  const silenceGroups = useMemo(() => {
    if (isEdit || !prefillAlerts?.length) return []
    const matchedAlerts = prefillAlerts.filter((a) => matchesLabelMatchers(a, formLabelMatchers))
    const map = new Map<string, { silence: Silence; alerts: EnrichedAlert[] }>()
    for (const alert of matchedAlerts) {
      for (const silenceId of alert.status.silencedBy) {
        const silence = allSilences.find(
          (s) => s.id === silenceId && (s.status.state === 'active' || s.status.state === 'pending'),
        )
        if (!silence) continue
        const entry = map.get(silenceId) ?? { silence, alerts: [] }
        entry.alerts.push(alert)
        map.set(silenceId, entry)
      }
    }
    return [...map.values()]
  }, [isEdit, prefillAlerts, allSilences, formLabelMatchers])

  // ── Matchers ────────────────────────────────────────────────────────────────

  function addMatcher() {
    setMatchers((m) => [...m, { id: nextId(), name: '', operator: '=', value: '' }])
  }

  function removeMatcher(id: number) {
    setMatchers((m) => m.filter((x) => x.id !== id))
  }

  function updateMatcher(id: number, field: keyof SilenceMatcher, value: string) {
    setMatchers((m) =>
      m.map((x) => {
        if (x.id !== id) return x
        const updated = { ...x, [field]: value }
        if (field === 'operator' && (value === '=' || value === '!=') && x.value.includes('|')) {
          updated.value = x.value.split('|')[0]
        }
        return updated
      }),
    )
  }

  // ── Clusters ────────────────────────────────────────────────────────────────

  function toggleCluster(name: string) {
    setSelectedClusters((prev) =>
      prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name],
    )
  }

  // ── Duration + end date sync ─────────────────────────────────────────────────

  // Spinner change → recompute endsAt (with carry-over wrap)
  function updateDuration(days: number, hours: number, minutes: number) {
    const { days: d, hours: h, minutes: m } = normalizeDuration(days, hours, minutes)
    setDDays(d)
    setDHours(h)
    setDMinutes(m)
    if (startsAt) {
      setEndsAt(format(addSeconds(new Date(startsAt), totalSeconds(d, h, m)), FMT))
    }
  }

  // Calendar change → update endsAt + recompute spinners
  function handleEndsAtChange(newVal: string) {
    setEndsAt(newVal)
    if (startsAt && newVal) {
      const { days, hours, minutes } = diffToSpinners(startsAt, newVal)
      setDDays(days)
      setDHours(hours)
      setDMinutes(minutes)
    }
  }

  // Reset end to default duration from now
  function resetEnd() {
    const mins = useSettingsStore.getState().defaultSilenceDurationMinutes
    const d = Math.floor(mins / (24 * 60))
    const h = Math.floor((mins % (24 * 60)) / 60)
    const m = mins % 60
    setDDays(d)
    setDHours(h)
    setDMinutes(m)
    if (startsAt) {
      setEndsAt(format(addSeconds(new Date(startsAt), totalSeconds(d, h, m)), FMT))
    }
  }

  // Start change → push endsAt forward keeping the same gap
  function handleStartsAtChange(newVal: string) {
    if (endsAt && startsAt && newVal) {
      const gap = new Date(endsAt).getTime() - new Date(startsAt).getTime()
      const newEnd = new Date(new Date(newVal).getTime() + (gap > 0 ? gap : 3_600_000))
      setEndsAt(format(newEnd, FMT))
    }
    setStartsAt(newVal)
  }

  // Apply template — fill matchers and reason from template
  function handleApplyTemplate(templateId: string) {
    if (!templateId) {
      setSelectedTemplate('')
      return
    }
    const template = templates.find((t) => t.id === templateId)
    if (!template) return

    setSelectedTemplate(templateId)

    // Replace matchers with template matchers
    const newMatchers = template.matchers.map((m) => ({
      id: nextId(),
      name: m.name,
      operator: (
        m.isRegex ? (m.isEqual ? '=~' : '!~') : m.isEqual ? '=' : '!='
      ) as LabelMatcherOperator,
      value: m.value,
    }))
    setMatchers(newMatchers)

    // Pre-fill comment with template reason if reason is not empty
    if (template.reason) {
      setComment(template.reason)
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function toRegexValue(value: string): string {
    return value.split('|').filter(Boolean).map(escapeRegex).join('|')
  }

  function buildLabelMatchers(): LabelMatcher[] {
    return matchers
      .filter((m) => m.name && m.value)
      .map((m) => ({
        id: String(m.id),
        name: m.name,
        operator: m.operator,
        value: m.operator === '=~' || m.operator === '!~' ? toRegexValue(m.value) : m.value,
      }))
  }

  // ── Preview ─────────────────────────────────────────────────────────────────

  const previewMatched = useCallback((): EnrichedAlert[] => {
    const lm = buildLabelMatchers()
    return allAlerts.filter(
      (a) => selectedClusters.includes(a.clusterName) && matchesLabelMatchers(a, lm),
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAlerts, matchers, selectedClusters])

  const matchedAlerts = useMemo(() => previewMatched(), [previewMatched])
  const liveMatchCount = matchedAlerts.length

  const hasActiveMatchers = matchers.some((m) => m.name && m.value)
  const parsedStartsAt = startsAt ? parse(startsAt, FMT, new Date()) : null
  const startsInFuture = Boolean(
    parsedStartsAt && isValid(parsedStartsAt) && parsedStartsAt.getTime() > Date.now(),
  )

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!user?.username) localStorage.setItem(USERNAME_KEY, createdBy.trim())

    const startDate = new Date(startsAt)
    const computedStartsAt = startDate.toISOString()
    const computedEndsAt = new Date(endsAt).toISOString()

    const amMatchers = matchers
      .filter((m) => m.name && m.value)
      .map((m) => ({
        isEqual: m.operator === '=' || m.operator === '=~',
        isRegex: m.operator === '=~' || m.operator === '!~',
        name: m.name,
        value: m.operator === '=~' || m.operator === '!~' ? toRegexValue(m.value) : m.value,
      }))

    const initial = new Map<string, ClusterResult>(
      selectedClusters.map((c) => [c, { status: 'loading' }]),
    )
    setResults(initial)
    setStep('results')

    let hadSuccess = false
    await Promise.all(
      selectedClusters.map(async (cluster) => {
        try {
          const r = await upsertSilence({
            cluster,
            matchers: amMatchers,
            startsAt: computedStartsAt,
            endsAt: computedEndsAt,
            createdBy: effectiveCreatedBy.trim(),
            comment: comment.trim(),
            id: isRecreate
              ? undefined
              : prefillGroup
              ? prefillGroup.find((s) => s.clusterName === cluster)?.id
              : prefillSilence?.clusterName === cluster
              ? prefillSilence?.id
              : undefined,
            fingerprint: fingerprint ?? prefillAlerts?.[0]?.fingerprint,
            performedBy: effectiveCreatedBy.trim(),
          })
          setResults((prev) => new Map(prev).set(cluster, { status: 'success', id: r.id }))
          hadSuccess = true
          qc.invalidateQueries({ queryKey: ['silences'] })
          const fp = fingerprint ?? prefillAlerts?.[0]?.fingerprint
          if (fp) qc.invalidateQueries({ queryKey: ['silence-events', fp] })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          setResults((prev) => new Map(prev).set(cluster, { status: 'error', message: msg }))
        }
      }),
    )
    if (hadSuccess) triggerPoll().catch(() => {})
  }

  const timeError = endsAt && startsAt
    ? new Date(endsAt) <= new Date(startsAt)
      ? 'End must be after start.'
      : null
    : null

  const canSubmit =
    !timeError &&
    comment.trim() &&
    effectiveCreatedBy.trim() &&
    selectedClusters.length > 0 &&
    Boolean(startsAt) &&
    Boolean(endsAt)

  // ── Form step ────────────────────────────────────────────────────────────────

  if (step === 'form') {
    return (
      <div className="space-y-5">
        {/* Existing silence warning */}
        {silenceGroups.length > 0 && (
          <div className="flex gap-2.5 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2.5 text-yellow-700 dark:text-yellow-400">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="w-full space-y-2.5 text-xs">
              <p className="text-sm font-medium">
                {silenceGroups.length === 1
                  ? '1 active silence already covers alerts in this group.'
                  : `${silenceGroups.length} active silences already cover alerts in this group.`}
              </p>
              {silenceGroups.map(({ silence: s, alerts }) => (
                <div key={s.id} className="space-y-1 opacity-90">
                  <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                    <span className="rounded bg-yellow-500/20 px-1 font-mono text-[10px]">{s.clusterName}</span>
                    <a
                      href={`${s.alertmanagerUrl}/#/silences/${s.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[10px] underline underline-offset-2 hover:opacity-70"
                    >
                      {s.id}
                    </a>
                    <span className="opacity-75">
                      until {new Date(s.endsAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })} {tzAbbr}
                    </span>
                  </div>
                  {s.comment && <p className="italic opacity-75">{s.comment}</p>}
                  <div className="flex flex-col gap-1">
                    {alerts.map((a) => (
                      <div key={a.fingerprint} className="flex flex-wrap gap-1">
                        {s.matchers.map((m) => {
                          const val = a.labels[m.name]
                          if (val === undefined) return null
                          return (
                            <span
                              key={m.name}
                              className="inline-flex items-center gap-0.5 rounded bg-yellow-500/20 px-1.5 py-0.5 font-mono text-[10px]"
                            >
                              <span className="opacity-70">{m.name}=</span>
                              <span>{val}</span>
                            </span>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Template selector */}
        {templates.length > 0 && (
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Template (optional)
            </label>
            <select
              value={selectedTemplate}
              onChange={(e) => handleApplyTemplate(e.target.value)}
              className="w-full h-8 px-2 py-1 text-xs border rounded bg-background border-input"
            >
              <option value="">— None —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {selectedTemplate && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                {matchers.length} matcher{matchers.length !== 1 ? 's' : ''} loaded from template
              </p>
            )}
          </div>
        )}

        {/* Cluster chips */}
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Cluster
          </label>
          <div className="flex flex-wrap gap-1.5">
            {availableClusters.map((c) => {
              const active = selectedClusters.includes(c)
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCluster(c)}
                  className={cn(
                    'flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                    active
                      ? 'border-primary bg-primary/20 text-foreground'
                      : 'border-dashed border-border text-muted-foreground hover:border-primary/60 hover:text-foreground',
                  )}
                >
                  {active && <Check className="h-3 w-3 shrink-0" />}
                  {c}
                </button>
              )
            })}
          </div>
        </div>

        {/* Matchers */}
        <div>
          <div className="mb-2 grid items-center gap-1.5" style={{ gridTemplateColumns: '160px 72px 1fr 32px' }}>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Matcher
            </span>
            <span />
            <button
              type="button"
              onClick={() => liveMatchCount > 0 && setAffectedOpen((o) => !o)}
              className={cn(
                'justify-self-end flex items-center gap-1 rounded px-2 py-0.5 text-xs font-bold tabular-nums transition-colors',
                liveMatchCount > 0
                  ? 'bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90'
                  : 'bg-accent text-muted-foreground cursor-default',
              )}
              title={liveMatchCount > 0 ? 'Click to show/hide affected alerts' : undefined}
            >
              <span className="text-base font-bold tabular-nums">{liveMatchCount}</span>
              <span className="text-xs font-semibold">affected alerts</span>
              {liveMatchCount > 0 && (
                affectedOpen
                  ? <ChevronUp className="h-3 w-3 shrink-0" />
                  : <ChevronDown className="h-3 w-3 shrink-0" />
              )}
            </button>
            <span />
          </div>

          {/* Expandable affected alerts panel — between badge and matcher rows */}
          {affectedOpen && liveMatchCount > 0 && (() => {
            // Pick the single most distinguishing label across matched alerts
            const idKey = pickIdentifierLabel(matchedAlerts)
            return (
            <div className="mb-2 rounded border border-border bg-muted/30 p-2 space-y-1 max-h-60 overflow-y-auto combo-dropdown">
              {matchedAlerts.map((alert) => (
                <div
                  key={alert.fingerprint}
                  className={cn('flex items-center gap-1.5 rounded px-1 -mx-1 py-0.5', onSelectAlert && 'cursor-pointer hover:bg-accent/50')}
                  onClick={() => onSelectAlert?.(alert.fingerprint)}
                >
                  <span className="font-mono text-xs font-medium shrink-0">
                    {alert.labels.alertname ?? alert.fingerprint.slice(0, 8)}
                  </span>
                  {alert.labels.severity && (
                    <span className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0',
                      alert.labels.severity === 'critical' && 'bg-destructive/20 text-destructive',
                      alert.labels.severity === 'warning' && 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400',
                      !['critical', 'warning'].includes(alert.labels.severity) && 'bg-accent text-muted-foreground',
                    )}>
                      {alert.labels.severity}
                    </span>
                  )}
                  {idKey && alert.labels[idKey] != null && (
                    <span className="truncate font-mono text-[11px] text-muted-foreground" title={`${idKey}=${alert.labels[idKey]}`}>
                      {alert.labels[idKey]}
                    </span>
                  )}
                </div>
              ))}
            </div>
            )
          })()}

          <div className="space-y-2">
            {matchers.map((m) => (
              <div
                key={m.id}
                className="grid items-start gap-1.5"
                style={{ gridTemplateColumns: '160px 72px 1fr 32px' }}
              >
                <LabelNameInput
                  value={m.name}
                  onChange={(v) => updateMatcher(m.id, 'name', v)}
                  suggestions={labelKeys}
                />
                <Select
                  value={m.operator}
                  onChange={(e) => updateMatcher(m.id, 'operator', e.target.value)}
                  className="h-8 w-full"
                  selectClassName="text-xs font-mono"
                >
                  <option value="=">=</option>
                  <option value="!=">!=</option>
                  <option value="=~">=~</option>
                  <option value="!~">!~</option>
                </Select>
                <div className="min-w-0">
                  <TagValueInput
                    value={m.value}
                    onChange={(v) => updateMatcher(m.id, 'value', v)}
                    suggestions={labelSuggestions.get(m.name) ?? []}
                    placeholder="value"
                    className="min-w-0"
                    maxTags={m.operator === '=' || m.operator === '!=' ? 1 : undefined}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => removeMatcher(m.id)}
                  disabled={matchers.length === 1}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" onClick={addMatcher} className="text-xs">
              <Plus className="mr-1 h-3 w-3" />
              Add matcher
            </Button>

            {/* Zero-match warning */}
            {hasActiveMatchers && liveMatchCount === 0 && (
              <div className="flex gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-amber-700 dark:text-amber-400">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="text-xs space-y-0.5">
                  <p>No current alerts match these matchers — the silence will be created but has no immediate effect.</p>
                  {startsInFuture ? (
                    <p className="opacity-80">
                      Start time is in the future, so this can be expected for planned maintenance windows.
                    </p>
                  ) : (
                    <p className="opacity-80">
                      Tip: For planned maintenance, set the start time to when the work begins.
                    </p>
                  )}
                  {selectedClusters.length < availableClusters.length && (
                    <p className="opacity-80">
                      Only {selectedClusters.length} of {availableClusters.length} clusters selected — matching alerts on other clusters won't be silenced.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Time */}
        <div className="space-y-3">
          {/* Start */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Start
              </label>
              <button
                type="button"
                onClick={() => setStartsAt(format(new Date(), FMT))}
                className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Now
              </button>
            </div>
            <DateTimePicker value={startsAt} onChange={handleStartsAtChange} />
          </div>

          {/* Ende — duration spinners and calendar side by side, always in sync */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Ende
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetEnd}
                className="h-7 gap-1.5 px-2.5 text-xs"
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </Button>
            </div>
            <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-stretch sm:justify-center">
              {/* Left column: presets + duration spinners */}
              <div className="flex shrink-0 flex-col items-center gap-4 self-center">
                {/* Quick-duration presets */}
                <div className="flex flex-wrap justify-center gap-1.5">
                  {DURATION_PRESETS.map((p) => {
                    const active = dDays === p.days && dHours === p.hours && dMinutes === p.minutes
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => updateDuration(p.days, p.hours, p.minutes)}
                        className={cn(
                          'rounded border px-3 py-1 text-xs font-medium transition-colors cursor-pointer',
                          active
                            ? 'border-primary bg-primary/20 text-foreground'
                            : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground',
                        )}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                </div>

                {/* Duration spinners — editable */}
                <div className="flex gap-8">
                  {[
                    {
                      label: 'days',
                      val: dDays,
                      inc: () => updateDuration(dDays + 1, dHours, dMinutes),
                      dec: () => updateDuration(dDays - 1, dHours, dMinutes),
                      set: (n: number) => updateDuration(n, dHours, dMinutes),
                    },
                    {
                      label: 'hours',
                      val: dHours,
                      inc: () => updateDuration(dDays, dHours + 1, dMinutes),
                      dec: () => updateDuration(dDays, dHours - 1, dMinutes),
                      set: (n: number) => updateDuration(dDays, n, dMinutes),
                    },
                    {
                      label: 'minutes',
                      val: dMinutes,
                      inc: () => updateDuration(dDays, dHours, dMinutes + 1),
                      dec: () => updateDuration(dDays, dHours, dMinutes - 1),
                      set: (n: number) => updateDuration(dDays, dHours, n),
                    },
                  ].map(({ label, val, inc, dec, set }) => (
                    <div key={label} className="flex flex-col items-center gap-1">
                      <button
                        type="button"
                        onClick={inc}
                        className="cursor-pointer text-muted-foreground hover:text-foreground"
                      >
                        <ChevronUp className="h-6 w-6" />
                      </button>
                      <input
                        type="number"
                        min={0}
                        value={val}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10)
                          if (!isNaN(n)) set(n)
                        }}
                        className="w-16 rounded border border-input bg-background text-center text-3xl font-light tabular-nums focus:outline-none focus:ring-1 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <button
                        type="button"
                        onClick={dec}
                        className="cursor-pointer text-muted-foreground hover:text-foreground"
                      >
                        <ChevronDown className="h-6 w-6" />
                      </button>
                      <span className="mt-1 text-xs text-muted-foreground">{label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* OR divider — horizontal on small, vertical on sm+ */}
              <div className="flex w-full flex-row items-center gap-2 sm:w-auto sm:flex-col sm:self-stretch sm:gap-0 sm:py-1">
                <div className="h-px flex-1 bg-border sm:h-auto sm:w-px sm:flex-1" />
                <span className="shrink-0 text-[10px] font-medium text-muted-foreground sm:py-2">or</span>
                <div className="h-px flex-1 bg-border sm:h-auto sm:w-px sm:flex-1" />
              </div>

              {/* Inline end date/time calendar */}
              <div className="min-w-0">
                <InlineDateTimePicker value={endsAt} onChange={handleEndsAtChange} />
                {timeError && (
                  <p className="mt-1 text-xs text-destructive">{timeError}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Author */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Author
          </label>
          {authMode !== 'none' ? (
            user ? (
              <div className="h-8 text-xs text-muted-foreground flex items-center px-2 rounded border border-border bg-muted">
                {user.username}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Login required to create a silence.</p>
            )
          ) : (
            <Input
              value={createdBy}
              onChange={(e) => setCreatedBy(e.target.value)}
              placeholder="Your name"
              className="text-xs"
            />
          )}
        </div>

        {/* Reason */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Reason <span className="text-destructive">*</span>
          </label>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Reason for the silence…"
            rows={3}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            type="button"
            className="flex-1"
            disabled={!canSubmit}
            onClick={() => setStep('preview')}
          >
            Preview
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  // ── Preview step ─────────────────────────────────────────────────────────────

  if (step === 'preview') {
    const matched = previewMatched()

    const previewEnd = endsAt ? format(new Date(endsAt), 'yyyy-MM-dd HH:mm') : '—'

    const previewDuration = (() => {
      const diffSecs = endsAt && startsAt
        ? Math.max(0, Math.floor((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 1000))
        : 0
      const d = Math.floor(diffSecs / 86400)
      const h = Math.floor((diffSecs % 86400) / 3600)
      const m = Math.floor((diffSecs % 3600) / 60)
      const parts: string[] = []
      if (d > 0) parts.push(`${d}d`)
      if (h > 0) parts.push(`${h}h`)
      if (m > 0) parts.push(`${m}m`)
      return parts.length > 0 ? parts.join(' ') : '< 1m'
    })()

    const activeMatchers = matchers.filter((m) => m.name && m.value)

    return (
      <div className="space-y-4">
        {/* Summary */}
        <div className="rounded border border-border p-3 text-xs space-y-1.5">
          <div className="grid grid-cols-[80px_1fr] gap-y-1.5">
            <span className="text-muted-foreground">Start</span>
            <span className="font-mono">{startsAt ? `${format(new Date(startsAt), 'yyyy-MM-dd HH:mm')} ${tzAbbr}` : '—'}</span>
            <span className="text-muted-foreground">Ende</span>
            <span className="font-mono">{previewEnd} {tzAbbr} <span className="text-muted-foreground ml-1">({previewDuration})</span></span>
            <span className="text-muted-foreground">Author</span>
            <span>{effectiveCreatedBy}</span>
            <span className="text-muted-foreground">Reason</span>
            <span className="break-all">{comment}</span>
          </div>
        </div>

        {/* Cluster */}
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cluster</p>
          <div className="flex flex-wrap gap-1.5">
            {selectedClusters.map((c) => (
              <span key={c} className="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium">
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* Active Matchers */}
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Matcher ({activeMatchers.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {activeMatchers.map((m) => (
              <span key={m.id} className="rounded bg-accent px-1.5 py-0.5 font-mono text-[10px]">
                {m.name} {m.operator} {m.value}
              </span>
            ))}
          </div>
        </div>

        {/* Affected Alerts */}
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Affected Alerts ({matched.length})
          </p>
          {matched.length === 0 ? (
            <p className="text-xs text-muted-foreground">No alerts match these matchers.</p>
          ) : (() => {
            // Pick the single most distinguishing label across matched alerts
            const idKey = pickIdentifierLabel(matched)
            return (
              <div className="combo-dropdown max-h-[35vh] space-y-1 overflow-y-auto">
                {matched.map((alert) => (
                  <div
                    key={alert.fingerprint}
                    className={cn('flex items-center gap-2 rounded border border-border px-2 py-1.5', onSelectAlert && 'cursor-pointer hover:border-border/80 hover:bg-accent/30')}
                    onClick={() => onSelectAlert?.(alert.fingerprint)}
                  >
                    <span className="text-xs font-medium text-foreground shrink-0">{alert.labels.alertname ?? alert.fingerprint.slice(0, 8)}</span>
                    {idKey && alert.labels[idKey] != null && (
                      <span className="truncate font-mono text-[11px] text-muted-foreground" title={`${idKey}=${alert.labels[idKey]}`}>
                        {alert.labels[idKey]}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )
          })()}
        </div>

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" onClick={() => setStep('form')}>
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Back
          </Button>
          <Button type="button" className="flex-1" onClick={handleSubmit}>
            {isEdit ? 'Update' : 'Create'}
          </Button>
        </div>
      </div>
    )
  }

  // ── Results step ─────────────────────────────────────────────────────────────

  const allDone = [...results.values()].every((r) => r.status !== 'loading')
  const anySuccess = [...results.values()].some((r) => r.status === 'success')

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Silence submitted</h3>

      <div className="space-y-2">
        {[...results.entries()].map(([cluster, result]) => (
          <div
            key={cluster}
            className="flex items-center gap-3 rounded border border-border px-3 py-2"
          >
            <span className="min-w-[100px] text-xs font-medium">{cluster}</span>

            {result.status === 'loading' && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}

            {result.status === 'success' && (
              <div className="flex items-center gap-1.5 overflow-hidden">
                <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
                {clusterUrlMap.has(cluster) ? (
                  <a
                    href={`${clusterUrlMap.get(cluster)}/#/silences/${result.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate font-mono text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    {result.id}
                  </a>
                ) : (
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {result.id}
                  </span>
                )}
              </div>
            )}

            {result.status === 'error' && (
              <div className="flex items-center gap-1.5">
                <CircleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />
                <span className="text-xs text-destructive">{result.message}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {allDone && (
        <div className="flex gap-2 pt-2">
          {!anySuccess && (
            <Button type="button" variant="outline" onClick={() => setStep('preview')}>
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Back
            </Button>
          )}
          <Button type="button" className="flex-1" onClick={onSuccess}>
            Close
          </Button>
        </div>
      )}
    </div>
  )
}
