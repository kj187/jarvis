import { useMemo } from 'react'
import { X, Lock } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { useAlerts } from '@/hooks/useAlerts'
import { getFilterableLabels } from '@/lib/alertUtils'
import type { LabelMatcherOperator } from '@/types'

const OPERATORS: LabelMatcherOperator[] = ['=', '!=', '=~', '!~']

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

function MatcherChip({
  id, name, operator, value, valueOptions, onUpdate, onRemove,
}: {
  id: string
  name: string
  operator: LabelMatcherOperator
  value: string
  valueOptions: string[]
  onUpdate: (partial: { operator?: LabelMatcherOperator; value?: string }) => void
  onRemove: () => void
}) {
  const datalistId = `mc-vals-${id}`
  return (
    <div className="flex items-center rounded border border-border h-7 bg-input">
      <datalist id={datalistId}>
        {valueOptions.map((v) => <option key={v} value={v} />)}
      </datalist>
      <span className="px-2 text-xs text-muted-foreground shrink-0 select-none whitespace-nowrap overflow-hidden text-ellipsis" style={{ maxWidth: '120px' }}>
        {name}
      </span>
      <div className="h-3.5 w-px bg-border shrink-0" />
      <select
        value={operator}
        onChange={(e) => onUpdate({ operator: e.target.value as LabelMatcherOperator })}
        className="h-full w-14 bg-transparent px-1 text-xs text-muted-foreground focus:outline-none cursor-pointer border-0"
        aria-label={`Filter operator ${id}`}
      >
        {OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
      </select>
      <div className="h-3.5 w-px bg-border shrink-0" />
      <input
        value={value}
        onChange={(e) => onUpdate({ value: e.target.value })}
        list={datalistId}
        className="h-full bg-transparent px-2 text-xs text-foreground focus:outline-none [&::-webkit-calendar-picker-indicator]:hidden"
        style={{ width: `${Math.min(Math.max(8, value.length + 4), 28)}ch` }}
        aria-label={`Filter label value ${id}`}
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

export function MatcherChipsBar() {
  const { filters, updateLabelMatcher, removeLabelMatcher } = useUIStore()
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

  if (filters.labelMatchers.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
      {filters.labelMatchers.map((m) =>
        m.locked ? (
          <LockedMatcherChip key={m.id} name={m.name} operator={m.operator} value={m.value} />
        ) : (
          <MatcherChip
            key={m.id}
            id={m.id}
            name={m.name}
            operator={m.operator}
            value={m.value}
            valueOptions={Array.from(labelValueMap.get(m.name) ?? []).sort()}
            onUpdate={(partial) => updateLabelMatcher(m.id, partial)}
            onRemove={() => removeLabelMatcher(m.id)}
          />
        )
      )}
    </div>
  )
}
