import { useState, useCallback, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format, addSeconds } from 'date-fns'
import { Plus, X, ChevronUp, ChevronDown, ArrowLeft, Check, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { useAlerts } from '@/hooks/useAlerts'
import { useSilences } from '@/hooks/useSilences'
import { matchesLabelMatchers } from '@/lib/alertUtils'
import { upsertSilence, triggerPoll } from '@/api/client'
import type { EnrichedAlert, LabelMatcher, LabelMatcherOperator, Silence } from '@/types'

const USERNAME_KEY = 'jarvis-username'

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
                placeholder="Suchen…"
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
                  "{filter.trim()}" verwenden
                </button>
              )}
              {filtered.length === 0 && !filter.trim() && (
                <div className="px-2.5 py-2 text-xs text-muted-foreground">Keine Labels</div>
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

function endsAtLabel(days: number, hours: number, minutes: number, start: Date): string {
  const secs = totalSeconds(days, hours, minutes)
  if (secs <= 0) return '—'
  return format(addSeconds(start, secs), 'dd.MM.yyyy HH:mm')
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

export interface SilenceFormProps {
  availableClusters: string[]
  prefillAlerts?: EnrichedAlert[]
  prefillSilence?: Silence
  isRecreate?: boolean
  fingerprint?: string
  onSuccess: () => void
  onCancel: () => void
}

export function SilenceForm({
  availableClusters,
  prefillAlerts,
  prefillSilence,
  isRecreate = false,
  fingerprint,
  onSuccess,
  onCancel,
}: SilenceFormProps) {
  const { data: allAlerts = [] } = useAlerts()
  const { data: allSilences = [] } = useSilences()
  const qc = useQueryClient()
  const isEdit = Boolean(prefillSilence) && !isRecreate

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

  const labelSuggestions = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const alert of prefillAlerts ?? []) {
      for (const [k, v] of Object.entries(alert.labels)) {
        const existing = map.get(k) ?? []
        if (!existing.includes(v)) existing.push(v)
        map.set(k, existing)
      }
    }
    return map
  }, [prefillAlerts])

  const labelKeys = useMemo(
    () => [...labelSuggestions.keys()].sort(),
    [labelSuggestions],
  )

  const [step, setStep] = useState<Step>('form')

  const [selectedClusters, setSelectedClusters] = useState<string[]>(() => {
    if (prefillSilence) return [prefillSilence.clusterName]
    if (prefillAlerts?.length) return [...new Set(prefillAlerts.map((a) => a.clusterName))]
    return availableClusters.slice(0, 1)
  })

  const [matchers, setMatchers] = useState<SilenceMatcher[]>(() => {
    if (prefillSilence?.matchers) {
      return prefillSilence.matchers.map((m) => ({
        id: nextId(),
        name: m.name,
        operator: (
          m.isRegex ? (m.isEqual ? '=~' : '!~') : m.isEqual ? '=' : '!='
        ) as LabelMatcherOperator,
        value: m.value,
      }))
    }
    if (prefillAlerts?.length) return buildPrefillMatchers(prefillAlerts)
    return [{ id: nextId(), name: '', operator: '=', value: '' }]
  })

  // Duration spinners
  const [dDays, setDDays] = useState(0)
  const [dHours, setDHours] = useState(1)
  const [dMinutes, setDMinutes] = useState(0)

  // End-mode toggle — edit starts in calendar (has existing end date), create in duration
  const [endMode, setEndMode] = useState<'duration' | 'calendar'>(() =>
    prefillSilence && !isRecreate ? 'calendar' : 'duration',
  )

  // Start/End datetime (always initialized)
  const [startsAt, setStartsAt] = useState(() =>
    prefillSilence && !isRecreate
      ? format(new Date(prefillSilence.startsAt), "yyyy-MM-dd'T'HH:mm")
      : format(new Date(), "yyyy-MM-dd'T'HH:mm"),
  )
  const [endsAt, setEndsAt] = useState(() =>
    prefillSilence && !isRecreate ? format(new Date(prefillSilence.endsAt), "yyyy-MM-dd'T'HH:mm") : '',
  )

  const [createdBy, setCreatedBy] = useState(() => localStorage.getItem(USERNAME_KEY) ?? '')
  const [comment, setComment] = useState(prefillSilence?.comment ?? '')

  const [results, setResults] = useState<Map<string, ClusterResult>>(new Map())

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
        // Switching to exact-match: drop all but first pipe-segment
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

  // ── End mode sync ────────────────────────────────────────────────────────────

  function switchEndMode(mode: 'duration' | 'calendar') {
    if (mode === endMode) return
    if (mode === 'duration' && endsAt && startsAt) {
      const diffSecs = Math.max(
        0,
        Math.floor((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 1000),
      )
      setDDays(Math.floor(diffSecs / 86400))
      setDHours(Math.floor((diffSecs % 86400) / 3600))
      setDMinutes(Math.floor((diffSecs % 3600) / 60))
    }
    if (mode === 'calendar' && startsAt) {
      setEndsAt(
        format(addSeconds(new Date(startsAt), totalSeconds(dDays, dHours, dMinutes)), "yyyy-MM-dd'T'HH:mm"),
      )
    }
    setEndMode(mode)
  }

  // When startsAt changes in calendar mode: keep the same gap → push endsAt forward.
  function handleStartsAtChange(newVal: string) {
    if (endMode === 'calendar' && endsAt && startsAt && newVal) {
      const gap = new Date(endsAt).getTime() - new Date(startsAt).getTime()
      const newEnd = new Date(new Date(newVal).getTime() + (gap > 0 ? gap : 3_600_000))
      setEndsAt(format(newEnd, "yyyy-MM-dd'T'HH:mm"))
    }
    setStartsAt(newVal)
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  // For regex operators each pipe-segment is a literal value → escape individually.
  // Keeps chip display raw while sending correct regex to Alertmanager.
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

  const liveMatchCount = useMemo(() => previewMatched().length, [previewMatched])

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    localStorage.setItem(USERNAME_KEY, createdBy.trim())

    const startDate = new Date(startsAt)
    const computedStartsAt = startDate.toISOString()
    const computedEndsAt =
      endMode === 'calendar'
        ? new Date(endsAt).toISOString()
        : addSeconds(startDate, totalSeconds(dDays, dHours, dMinutes)).toISOString()

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
            createdBy: createdBy.trim(),
            comment: comment.trim(),
            id: prefillSilence?.clusterName === cluster ? prefillSilence?.id : undefined,
            fingerprint: fingerprint ?? prefillAlerts?.[0]?.fingerprint,
            performedBy: createdBy.trim(),
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

  const secs = totalSeconds(dDays, dHours, dMinutes)

  const timeError = endMode === 'calendar' && endsAt && startsAt
    ? new Date(endsAt) <= new Date(startsAt)
      ? 'Ende muss nach dem Start liegen.'
      : null
    : null

  const canSubmit =
    !timeError &&
    comment.trim() &&
    createdBy.trim() &&
    selectedClusters.length > 0 &&
    Boolean(startsAt) &&
    (endMode === 'calendar' ? Boolean(endsAt) : secs > 0)

  // ── Form step ────────────────────────────────────────────────────────────────

  if (step === 'form') {
    return (
      <div className="space-y-5">
        {/* Existing silence warning */}
        {silenceGroups.length > 0 && (
          <div className="flex gap-2.5 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2.5 text-yellow-700 dark:text-yellow-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="w-full space-y-2.5 text-xs">
              <p className="text-sm font-medium">
                {silenceGroups.length === 1
                  ? '1 aktive Silence betrifft bereits Alerts in dieser Gruppe.'
                  : `${silenceGroups.length} aktive Silences betreffen bereits Alerts in dieser Gruppe.`}
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
                      bis {new Date(s.endsAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
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

        {/* Cluster chips */}
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Cluster
          </label>
          <div className="flex flex-wrap gap-1.5">
            {availableClusters.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => !isEdit && toggleCluster(c)}
                className={cn(
                  'rounded border px-2.5 py-1 text-xs font-medium transition-colors',
                  selectedClusters.includes(c)
                    ? 'border-primary bg-primary/20 text-foreground'
                    : 'border-border text-muted-foreground hover:border-primary/50',
                  isEdit && 'cursor-default opacity-70',
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Matchers */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Matcher
            </span>
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition-colors',
                liveMatchCount > 0
                  ? 'bg-primary/20 text-primary'
                  : 'bg-accent text-muted-foreground',
              )}
            >
              {liveMatchCount} betroffen
            </span>
          </div>
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
                <TagValueInput
                  value={m.value}
                  onChange={(v) => updateMatcher(m.id, 'value', v)}
                  suggestions={labelSuggestions.get(m.name) ?? []}
                  placeholder="value"
                  className="min-w-0"
                  maxTags={m.operator === '=' || m.operator === '!=' ? 1 : undefined}
                />
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
              Matcher hinzufügen
            </Button>
          </div>
        </div>

        {/* Time */}
        <div className="space-y-3">
          {/* Start — always editable */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Start
              </label>
              <button
                type="button"
                onClick={() => setStartsAt(format(new Date(), "yyyy-MM-dd'T'HH:mm"))}
                className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Jetzt
              </button>
            </div>
            <DateTimePicker value={startsAt} onChange={handleStartsAtChange} />
          </div>

          {/* Ende — edit: always calendar; create: toggle Dauer | Datum */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Ende
                {endMode === 'duration' && secs > 0 && startsAt && (
                  <span className="ml-1.5 font-normal normal-case text-muted-foreground/60">
                    · {endsAtLabel(dDays, dHours, dMinutes, new Date(startsAt))}
                  </span>
                )}
              </label>
              <div className="flex overflow-hidden rounded border border-border text-[10px]">
                {(['duration', 'calendar'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => switchEndMode(mode)}
                    className={cn(
                      'px-2 py-0.5 transition-colors',
                      endMode === mode
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:bg-accent/50',
                    )}
                  >
                    {mode === 'duration' ? 'Dauer' : 'Datum'}
                  </button>
                ))}
              </div>
            </div>

            {endMode === 'calendar' ? (
              <>
                <DateTimePicker value={endsAt} onChange={setEndsAt} />
                {timeError && (
                  <p className="mt-1 text-xs text-destructive">{timeError}</p>
                )}
              </>
            ) : (
              <div className="flex gap-6">
                {(
                  [
                    { label: 'days', val: dDays, set: (v: number) => setDDays(clamp(v, 0, 365)) },
                    { label: 'hours', val: dHours, set: (v: number) => setDHours(clamp(v, 0, 23)) },
                    { label: 'minutes', val: dMinutes, set: (v: number) => setDMinutes(clamp(v, 0, 59)) },
                  ] as const
                ).map(({ label, val, set }) => (
                  <div key={label} className="flex flex-col items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => set(val + 1)}
                      className="cursor-pointer text-muted-foreground hover:text-foreground"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <span className="w-10 text-center text-2xl font-light tabular-nums">{val}</span>
                    <button
                      type="button"
                      onClick={() => set(val - 1)}
                      className="cursor-pointer text-muted-foreground hover:text-foreground"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <span className="mt-0.5 text-[10px] text-muted-foreground">{label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Author */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Author
          </label>
          <Input
            value={createdBy}
            onChange={(e) => setCreatedBy(e.target.value)}
            placeholder="Dein Name"
            className="text-xs"
          />
        </div>

        {/* Comment */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Kommentar <span className="text-destructive">*</span>
          </label>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Grund für die Silence…"
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
            Vorschau
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Abbrechen
          </Button>
        </div>
      </div>
    )
  }

  // ── Preview step ─────────────────────────────────────────────────────────────

  if (step === 'preview') {
    const matched = previewMatched()

    const previewEnd = endMode === 'calendar' && endsAt
      ? format(new Date(endsAt), 'dd.MM.yyyy HH:mm')
      : startsAt
        ? endsAtLabel(dDays, dHours, dMinutes, new Date(startsAt))
        : '—'

    const previewDuration = (() => {
      const diffSecs = endMode === 'duration'
        ? totalSeconds(dDays, dHours, dMinutes)
        : endsAt && startsAt
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
            <span className="font-mono">{startsAt ? format(new Date(startsAt), 'dd.MM.yyyy HH:mm') : '—'}</span>
            <span className="text-muted-foreground">Ende</span>
            <span className="font-mono">{previewEnd} <span className="text-muted-foreground ml-1">({previewDuration})</span></span>
            <span className="text-muted-foreground">Author</span>
            <span>{createdBy}</span>
            <span className="text-muted-foreground">Kommentar</span>
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

        {/* Aktive Matcher */}
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

        {/* Betroffene Alerts */}
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Betroffene Alerts ({matched.length})
          </p>
          {matched.length === 0 ? (
            <p className="text-xs text-muted-foreground">Keine Alerts treffen diese Matcher.</p>
          ) : (
            <div className="combo-dropdown max-h-[35vh] space-y-2 overflow-y-auto">
              {matched.map((alert) => (
                <div key={alert.fingerprint} className="flex flex-wrap gap-1 rounded border border-border p-2">
                  {Object.entries(alert.labels).map(([k, v]) => (
                    <span key={k} className="rounded bg-accent px-1.5 py-0.5 font-mono text-[10px]">
                      {k}: {v}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" onClick={() => setStep('form')}>
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Zurück
          </Button>
          <Button type="button" className="flex-1" onClick={handleSubmit}>
            {isEdit ? 'Aktualisieren' : 'Erstellen'}
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
      <h3 className="text-sm font-semibold">Silence eingereicht</h3>

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
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
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
              Zurück
            </Button>
          )}
          <Button type="button" className="flex-1" onClick={onSuccess}>
            Schließen
          </Button>
        </div>
      )}
    </div>
  )
}
