import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Lock, Plus, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { useAlerts } from '@/hooks/useAlerts'
import { getFilterableLabels, parseDurationValue } from '@/lib/alertUtils'
import type { LabelMatcherOperator } from '@/types'

const OPERATORS: LabelMatcherOperator[] = ['=', '!=', '=~', '!~']
/** `>`/`<` are only meaningful for `@age` — never offered for normal labels (decision 1). */
const AGE_OPERATORS: LabelMatcherOperator[] = ['>', '<']
/** Always-suggested pseudo-fields that don't reliably appear via the live label snapshot:
 * `@age` never does (excluded from `getFilterableLabels` — it's a moving target, not a
 * static label), `@claimed-by` only when some alert is currently claimed. */
const PSEUDO_FIELD_SUGGESTIONS = ['@age', '@claimed-by']
const AGE_VALUE_SUGGESTIONS = ['5m', '15m', '30m', '1h', '4h', '1d']

// ── Operator dropdown (styled to match the autocomplete) ──────────────────────

function OperatorSelect({
  value,
  operators,
  onChange,
}: {
  value: LabelMatcherOperator
  operators: LabelMatcherOperator[]
  onChange: (op: LabelMatcherOperator) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  return (
    <div ref={ref} className="relative flex h-7 items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-full items-center gap-0.5 px-1.5 text-xs font-mono text-muted-foreground hover:text-foreground focus:outline-none cursor-pointer"
        aria-label="Operator"
      >
        {value}
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="combo-dropdown absolute left-0 top-full z-50 -mt-px min-w-full overflow-hidden rounded-b border-x border-b border-border bg-popover shadow-lg">
          {operators.map((op) => (
            <button
              key={op}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(op); setOpen(false) }}
              className={cn(
                'w-full px-2.5 py-1.5 text-left text-xs font-mono cursor-pointer hover:bg-accent/60',
                op === value ? 'bg-accent text-accent-foreground' : 'text-foreground',
              )}
            >
              {op}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Chip-in-input field (label = single tag, value = multiple tags) ───────────

function TagField({
  values,
  onChange,
  suggestions,
  placeholder,
  single,
  ariaLabel,
  autoFocus,
  maxWidthClass,
  invalid,
}: {
  values: string[]
  onChange: (next: string[]) => void
  suggestions: string[]
  placeholder: string
  single?: boolean
  ariaLabel: string
  autoFocus?: boolean
  maxWidthClass: string
  /** Renders committed tags with a destructive style — e.g. an `@age` value that isn't a valid duration. */
  invalid?: boolean
}) {
  const [inputVal, setInputVal] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function addTag(raw: string) {
    const tag = raw.trim()
    if (!tag) return
    if (single) {
      onChange([tag])
    } else if (!values.includes(tag)) {
      onChange([...values, tag])
    }
    setInputVal('')
  }

  function removeTag(index: number) {
    onChange(values.filter((_, i) => i !== index))
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(inputVal)
    } else if (e.key === 'Escape') {
      setOpen(false)
    } else if (e.key === 'Backspace' && !inputVal && values.length > 0) {
      removeTag(values.length - 1)
    }
  }

  const filtered = suggestions.filter(
    (s) => !values.includes(s) && s.toLowerCase().includes(inputVal.toLowerCase()),
  )

  // For single fields, hide the text input once a tag is set (X clears it).
  const showInput = !single || values.length === 0

  return (
    <div ref={containerRef} className="relative flex h-7 min-w-0 items-center">
      <div
        className={cn('flex h-full flex-wrap items-center gap-1 py-0.5 px-1.5 cursor-text', maxWidthClass)}
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((tag, i) => (
          <span
            key={i}
            title={invalid ? 'Invalid duration — use e.g. 15m, 2h, 1d' : tag}
            className={cn(
              'flex min-w-0 shrink items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px]',
              invalid
                ? 'bg-destructive/15 text-destructive border border-destructive/50'
                : 'bg-accent text-accent-foreground',
            )}
          >
            <span className="min-w-0 truncate">{tag}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(i) }}
              className="ml-0.5 shrink-0 cursor-pointer opacity-60 hover:opacity-100 hover:text-destructive"
              aria-label={`Remove ${ariaLabel} ${tag}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        {showInput && (
          <input
            ref={inputRef}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setOpen(true)}
            placeholder={values.length === 0 ? placeholder : undefined}
            size={1}
            style={{
              minWidth: values.length === 0 ? '7rem' : undefined,
              width: inputVal
                ? `${inputVal.length + 1}ch`
                : values.length === 0
                  ? '7rem'
                  : '2ch',
            }}
            className="bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
            aria-label={ariaLabel}
            autoComplete="off"
            autoFocus={autoFocus}
          />
        )}
      </div>
      {open && showInput && filtered.length > 0 && (
        <div className="combo-dropdown absolute left-0 top-full z-50 -mt-px max-h-48 min-w-full overflow-y-auto rounded-b border-x border-b border-border bg-popover shadow-lg">
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); addTag(opt); setOpen(false) }}
              className="w-full whitespace-nowrap px-3 py-1.5 text-left text-xs text-foreground hover:bg-accent/60 cursor-pointer"
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Locked chip (default filter from Settings) ────────────────────────────────

function LockedMatcherChip({ name, operator, value }: { name: string; operator: string; value: string }) {
  return (
    <div
      className="flex items-center rounded border border-border/60 h-7 opacity-75 bg-input"
      title="Default filter set in Settings — open Settings (⚙) to change or remove"
    >
      <span className="px-2 text-xs text-muted-foreground shrink-0 select-none whitespace-nowrap overflow-hidden text-ellipsis" style={{ maxWidth: '120px' }}>
        {name}
      </span>
      <div className="h-3.5 w-px bg-border shrink-0" />
      <span className="px-1.5 text-xs text-muted-foreground font-mono shrink-0">{operator}</span>
      <div className="h-3.5 w-px bg-border shrink-0" />
      <span className="px-2 text-xs text-foreground shrink-0">{value}</span>
      <Lock className="mr-1.5 ml-0.5 h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />
    </div>
  )
}

// ── Editable filter chip ──────────────────────────────────────────────────────

type Draft = { name: string; operator: LabelMatcherOperator; value: string }

function EditableMatcherChip({
  value: matcher,
  labelValueMap,
  labelNames,
  onChange,
  onRemove,
  autoFocus,
}: {
  value: Draft
  labelValueMap: Map<string, Set<string>>
  labelNames: string[]
  onChange: (next: Draft) => void
  onRemove: () => void
  autoFocus?: boolean
}) {
  const { name, operator, value } = matcher
  const valueTags = value ? value.split('|').filter(Boolean) : []
  const isAgeField = name === '@age'
  const ageInvalid = isAgeField && value !== '' && parseDurationValue(value) === null

  const valueOptions = useMemo(() => {
    if (isAgeField) return AGE_VALUE_SUGGESTIONS
    if (name && labelValueMap.has(name)) {
      return Array.from(labelValueMap.get(name)!).sort()
    }
    const all = new Set<string>()
    labelValueMap.forEach((vals) => vals.forEach((v) => all.add(v)))
    return Array.from(all).sort()
  }, [labelValueMap, name, isAgeField])

  return (
    <div
      className={cn(
        'flex items-center rounded border bg-input min-h-7 max-w-full',
        ageInvalid ? 'border-destructive' : 'border-border',
      )}
    >
      <TagField
        values={name ? [name] : []}
        onChange={(arr) => {
          const nextName = arr[0] ?? ''
          const nextIsAge = nextName === '@age'
          const wasAgeOperator = operator === '>' || operator === '<'
          // >/< are @age-only (decision 1) — snap the operator when the field
          // switches into or out of @age so the dropdown never shows a stale,
          // now-invalid operator.
          let nextOperator = operator
          if (nextIsAge && !wasAgeOperator) nextOperator = '>'
          else if (!nextIsAge && wasAgeOperator) nextOperator = '='
          onChange({ ...matcher, name: nextName, operator: nextOperator })
        }}
        suggestions={labelNames}
        placeholder="label"
        single
        ariaLabel="Label name"
        autoFocus={autoFocus}
        maxWidthClass="max-w-[12rem]"
      />
      <div className="h-3.5 w-px bg-border shrink-0" />
      <OperatorSelect
        value={operator}
        operators={isAgeField ? AGE_OPERATORS : OPERATORS}
        onChange={(op) => {
          const isRegex = op === '=~' || op === '!~'
          // = / != allow only a single value — collapse extras when leaving regex.
          const nextValue = !isRegex && valueTags.length > 1 ? valueTags[0] : value
          onChange({ ...matcher, operator: op, value: nextValue })
        }}
      />
      <div className="h-3.5 w-px bg-border shrink-0" />
      <TagField
        values={valueTags}
        onChange={(arr) => onChange({ ...matcher, value: arr.join('|') })}
        suggestions={valueOptions}
        placeholder={isAgeField ? '15m' : 'value'}
        single={operator === '=' || operator === '!=' || operator === '>' || operator === '<'}
        ariaLabel="Label value"
        maxWidthClass="max-w-[20rem]"
        invalid={ageInvalid}
      />
      <button
        onClick={onRemove}
        className="mr-1.5 ml-0.5 cursor-pointer text-muted-foreground hover:text-foreground shrink-0"
        aria-label={`Remove filter ${name}${operator}${value}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

// ── Bar ───────────────────────────────────────────────────────────────────────

let draftSeq = 0

export function MatcherChipsBar({ allowAdd = false }: { allowAdd?: boolean }) {
  const { filters, addLabelMatcher, updateLabelMatcher, removeLabelMatcher } = useUIStore()
  const { data: allAlerts = [] } = useAlerts()
  const [drafts, setDrafts] = useState<{ id: string; data: Draft }[]>([])

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

  const labelNames = useMemo(() => {
    const names = new Set(labelValueMap.keys())
    PSEUDO_FIELD_SUGGESTIONS.forEach((n) => names.add(n))
    return Array.from(names).sort()
  }, [labelValueMap])

  function updateDraft(id: string, next: Draft) {
    // Promote to a real filter as soon as both label and value are present —
    // except an @age draft with an unparseable duration, which must not
    // commit as a chip that can never match (decision 3 + done-criterion).
    const ageInvalid = next.name === '@age' && parseDurationValue(next.value) === null
    if (next.name && next.value && !ageInvalid) {
      addLabelMatcher(next)
      setDrafts((d) => d.filter((x) => x.id !== id))
      return
    }
    setDrafts((d) => d.map((x) => (x.id === id ? { ...x, data: next } : x)))
  }

  if (filters.labelMatchers.length === 0 && drafts.length === 0 && !allowAdd) return null

  return (
    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
      {filters.labelMatchers.map((m) =>
        m.locked ? (
          <LockedMatcherChip key={m.id} name={m.name} operator={m.operator} value={m.value} />
        ) : (
          <EditableMatcherChip
            key={m.id}
            value={{ name: m.name, operator: m.operator, value: m.value }}
            labelValueMap={labelValueMap}
            labelNames={labelNames}
            onChange={(next) => updateLabelMatcher(m.id, next)}
            onRemove={() => removeLabelMatcher(m.id)}
          />
        ),
      )}

      {drafts.map((draft) => (
        <EditableMatcherChip
          key={draft.id}
          value={draft.data}
          labelValueMap={labelValueMap}
          labelNames={labelNames}
          autoFocus
          onChange={(next) => updateDraft(draft.id, next)}
          onRemove={() => setDrafts((d) => d.filter((x) => x.id !== draft.id))}
        />
      ))}

      {allowAdd && (() => {
        const isEmpty = filters.labelMatchers.length === 0 && drafts.length === 0
        return (
          <button
            onClick={() =>
              setDrafts((d) => [...d, { id: `draft-${draftSeq++}`, data: { name: '', operator: '=', value: '' } }])
            }
            className={cn(
              'flex items-center justify-center h-7 shrink-0 rounded border bg-input cursor-pointer transition-colors',
              isEmpty
                ? 'gap-1 px-2.5 border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-accent/40'
                : 'w-7 border-border text-muted-foreground hover:text-foreground hover:bg-accent/40',
            )}
            aria-label="Add filter"
          >
            <Plus className="h-3 w-3" />
            {isEmpty && <span className="text-xs">Add filter</span>}
          </button>
        )
      })()}
    </div>
  )
}
