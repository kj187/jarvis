import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { LabelMatcher, LabelMatcherOperator } from '@/types'

interface AlertFiltersProps {
  stateFilter: string
  onStateFilterChange: (v: string) => void
  matchers: LabelMatcher[]
  onAddMatcher: (matcher: Omit<LabelMatcher, 'id'>) => void
  onRemoveMatcher: (id: string) => void
  onClearMatchers: () => void
}

const OPERATORS: LabelMatcherOperator[] = ['=', '!=', '=~', '!~']

export function AlertFilters({
  stateFilter,
  onStateFilterChange,
  matchers,
  onAddMatcher,
  onRemoveMatcher,
  onClearMatchers,
}: AlertFiltersProps) {
  const [newName, setNewName] = useState('')
  const [newOp, setNewOp] = useState<LabelMatcherOperator>('=')
  const [newValue, setNewValue] = useState('')

  function handleAdd() {
    if (!newName || !newValue) return
    onAddMatcher({ name: newName, operator: newOp, value: newValue })
    setNewName('')
    setNewValue('')
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* State filter */}
      <Select
        value={stateFilter}
        onChange={(e) => onStateFilterChange(e.target.value)}
        className="w-36"
        aria-label="State filter"
      >
        <option value="">All states</option>
        <option value="active">Active</option>
        <option value="suppressed">Suppressed</option>
        <option value="unprocessed">Unprocessed</option>
        <option value="resolved">Resolved</option>
      </Select>

      {/* Existing matchers */}
      {matchers.map((m) => (
        <div
          key={m.id}
          className="flex items-center gap-1 rounded-full border border-border bg-accent px-2.5 py-1 text-xs"
        >
          <span className="text-muted-foreground">{m.name}</span>
          <span className="font-mono text-accent-foreground">{m.operator}</span>
          <span>{m.value}</span>
          <button
            onClick={() => onRemoveMatcher(m.id)}
            className="ml-1 cursor-pointer text-muted-foreground hover:text-foreground"
            aria-label={`Remove matcher ${m.name}${m.operator}${m.value}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}

      {matchers.length > 1 && (
        <Button variant="ghost" size="sm" onClick={onClearMatchers} className="h-7 text-xs">
          Remove all
        </Button>
      )}

      {/* Add matcher form */}
      <div className="flex items-center gap-1">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="label"
          className="h-8 w-24 text-xs"
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <Select
          value={newOp}
          onChange={(e) => setNewOp(e.target.value as LabelMatcherOperator)}
          className="h-8 w-14 shrink-0"
          selectClassName="text-xs font-mono"
        >
          {OPERATORS.map((op) => (
            <option key={op} value={op}>{op}</option>
          ))}
        </Select>
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="value"
          className="h-8 w-24 text-xs"
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleAdd} disabled={!newName || !newValue}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}
